import fs from 'fs';
import { execSync } from 'child_process';
import { buildCppHarness } from '../src/renderer/src/components/dsa/cppHarness.js';

// The user code
const code = `class Solution {
public:
    int findMaxLength(vector<int>& nums) {
        return 6; // Mock implementation for test
    }
};`;

const args = [[0,1,1,1,1,1,0,0,0]];

const prebuilt = buildCppHarness(code, args);

// Simulate the deterministic wrapper logic
const aiReturnedMethodBody = `
    int findMaxLength(vector<int>& nums) {
        std::cout << "__DSA__" << "{\\"stepIndex\\":0,\\"line\\":3,\\"event\\":\\"start\\",\\"variables\\":{\\"count\\":6},\\"callStack\\":[]}" << std::endl;
        int count = 6;
        return count;
    }
`;

const instrumentedSolution = `class Solution {\npublic:\n${aiReturnedMethodBody}\n};`;

const finalCode = prebuilt.preamble + instrumentedSolution + prebuilt.suffix;

fs.writeFileSync('test.cpp', finalCode);

console.log('Compiling test.cpp...');
try {
    execSync('g++ test.cpp -o test.exe', { stdio: 'inherit' });
    console.log('Compilation successful. Running test.exe...');
    const output = execSync('.\\test.exe', { encoding: 'utf-8' });
    console.log('\n--- Trace Output ---');
    console.log(output);
} catch (e) {
    console.error('Error:', e.message);
}
