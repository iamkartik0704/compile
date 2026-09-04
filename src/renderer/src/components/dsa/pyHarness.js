export function buildPyHarness(userCode, sampleInput) {
  // Try to find the main method inside class Solution
  const classMatch = userCode.match(/class\s+Solution\b/);
  if (!classMatch) {
    return { ok: false, error: "Couldn't find 'class Solution' in Python code." };
  }

  const methodRe = /def\s+([a-zA-Z_]\w*)\s*\(\s*self\b([^)]*)\)/;
  const m = userCode.match(methodRe);
  if (!m) {
    return { ok: false, error: "Couldn't find a valid method in class Solution." };
  }
  const funcName = m[1];
  const paramsStr = m[2] || '';

  const numParams = paramsStr.split(',').map(p => p.trim()).filter(Boolean).length;
  const args = (Array.isArray(sampleInput) && sampleInput.length === numParams) ? sampleInput : [sampleInput];
  const argsJson = args.map(a => JSON.stringify(a)).join(', ');

  const preamble = `
import json
import sys

# ── DSA Trace Helper ──
__dsa_stepIndex = 0
def dsa_snapshot(line, event, vars_dict, ds_dict):
    global __dsa_stepIndex
    if __dsa_stepIndex > 200: return
    
    # helper to clean up complex objects for json
    def clean(obj):
        if hasattr(obj, 'val'): # TreeNode/ListNode
            return {"val": obj.val, "left": clean(getattr(obj, 'left', None)), "right": clean(getattr(obj, 'right', None)), "next": clean(getattr(obj, 'next', None))}
        if isinstance(obj, list):
            return [clean(x) for x in obj]
        if isinstance(obj, dict):
            return {str(k): clean(v) for k, v in obj.items()}
        return obj

    v = {k: clean(v) for k, v in vars_dict.items() if v is not None} if vars_dict and vars_dict != "{}" and vars_dict != "null" else {}
    d = {k: clean(v) for k, v in ds_dict.items() if v is not None} if ds_dict and ds_dict != "null" else "null"
    
    print("__DSA__" + json.dumps({
        "stepIndex": __dsa_stepIndex,
        "line": line,
        "event": event,
        "variables": v,
        "dataStructureState": d
    }))
    __dsa_stepIndex += 1

# ── User Code ──
`;

  const suffix = `
# ── Test Execution ──
if __name__ == '__main__':
    sol = Solution()
    args = [${argsJson}]
    result = sol.${funcName}(*args)
    print(json.dumps(result))
`;

  return {
    ok: true,
    code: preamble + userCode + suffix,
    preamble,
    suffix,
    funcName
  };
}
