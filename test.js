const body = `
class Solution {
public:
    int count = 0;
    int maxCount = 0;
    int currVal = 0;
    vector<int> modes;   // refers to the mode
        // from the inorder of the tree we can use
        // maxFreq variable to count the frequency
        // for the currNode
    void inorder(TreeNode* root){
    }

    vector<int> findMode(TreeNode* root) {
    }
};
`;

const methodRe = /([A-Za-z_][\w:<>,\s*&]*?)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:const\s*)?\{/g;
let match;
while ((match = methodRe.exec(body)) !== null) {
  console.log("MATCH:");
  console.log("  ret:", JSON.stringify(match[1]));
  console.log("  name:", JSON.stringify(match[2]));
  console.log("  args:", JSON.stringify(match[3]));
}
