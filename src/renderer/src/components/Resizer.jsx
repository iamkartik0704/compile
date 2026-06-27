import React, { useState, useEffect, useCallback } from 'react'
import '../assets/resizer.css'

export const Resizer = ({ orientation = 'vertical', onResize }) => {
  const [isResizing, setIsResizing] = useState(false)

  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    setIsResizing(true)
  }, [])

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e) => {
      onResize(e.clientX, e.clientY)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    
    // Add a class to body to keep the cursor consistent while dragging and prevent selection
    document.body.classList.add(orientation === 'vertical' ? 'resizing-col' : 'resizing-row')
    const originalUserSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.classList.remove(orientation === 'vertical' ? 'resizing-col' : 'resizing-row')
      document.body.style.userSelect = originalUserSelect
    }
  }, [isResizing, onResize, orientation])

  return (
    <>
      <div 
        className={`resizer-${orientation}`} 
        onMouseDown={handleMouseDown}
      />
      {isResizing && (
        <div className="resizing-overlay" style={{ cursor: orientation === 'vertical' ? 'col-resize' : 'row-resize' }} />
      )}
    </>
  )
}
