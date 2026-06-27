export function unescapeXml(unsafe) {
  return unsafe
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
}

export function applyDiff(oldText, body) {
  let newText = oldText || ''
  const blockRegex = /<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>/g
  let match
  let hasChanges = false
  const editRanges = []
  
  while ((match = blockRegex.exec(body)) !== null) {
    let search = unescapeXml(match[1])
    let replace = unescapeXml(match[2])
    
    if (search.trim() === '') {
       newText = replace
       hasChanges = true
       editRanges.push({ startLine: 1, endLine: replace.split('\n').length })
       continue
    }

    if (search.startsWith('\n')) search = search.substring(1)
    if (search.endsWith('\n')) search = search.substring(0, search.length - 1)
    if (replace.startsWith('\n')) replace = replace.substring(1)
    if (replace.endsWith('\n')) replace = replace.substring(0, replace.length - 1)
    
    const trackEdit = (offset) => {
      const preText = newText.substring(0, offset)
      const startLine = preText.split('\n').length
      const endLine = startLine + replace.split('\n').length - 1
      editRanges.push({ startLine, endLine })
    }

    if (newText.includes(search)) {
      newText = newText.replace(search, (m, offset) => {
        trackEdit(offset)
        return replace
      })
      hasChanges = true
    } else {
      const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const searchLines = search.split('\n').map(l => l.trim()).filter(l => l.length > 0)
      
      if (searchLines.length > 0) {
        const pattern = searchLines.map(escapeRegExp).join('\\s+')
        try {
          const regex = new RegExp(pattern)
          const fuzzyMatch = newText.match(regex)
          if (fuzzyMatch) {
            newText = newText.replace(fuzzyMatch[0], (m, offset) => {
              trackEdit(offset)
              return replace
            })
            hasChanges = true
          } else {
            console.warn("Could not find search block exactly or fuzzily as requested")
          }
        } catch (e) {
          console.warn("Fuzzy regex failed", e)
        }
      } else {
        console.warn("Search block contained only whitespace but was not completely empty.")
      }
    }
  }

  return { newText, hasChanges, editRanges }
}
