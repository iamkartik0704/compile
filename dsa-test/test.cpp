#include <iostream>
#include <vector>
#include <string>
#include <utility>
using namespace std;

template <typename T>
static void dsa_printVec(const std::vector<T>& v) {
  std::cout << "[";
  for (size_t i = 0; i < v.size(); ++i) { if (i) std::cout << ","; std::cout << v[i]; }
  std::cout << "]";
}
template <>
void dsa_printVec<std::string>(const std::vector<std::string>& v) {
  std::cout << "[";
  for (size_t i = 0; i < v.size(); ++i) { if (i) std::cout << ","; std::cout << "\"" << v[i] << "\""; }
  std::cout << "]";
}
template <>
void dsa_printVec<bool>(const std::vector<bool>& v) {
  std::cout << "[";
  for (size_t i = 0; i < v.size(); ++i) { if (i) std::cout << ","; std::cout << (v[i] ? "true" : "false"); }
  std::cout << "]";
}
template <typename T>
static void dsa_printVec(const std::vector<std::vector<T>>& v) {
  std::cout << "[";
  for (size_t i = 0; i < v.size(); ++i) { if (i) std::cout << ","; dsa_printVec<T>(v[i]); }
  std::cout << "]";
}

// ── User code (Solution class) — AI-instrumented with __DSA__ emissions ──
class Solution {
public:

    int findMaxLength(vector<int>& nums) {
        std::cout << "__DSA__" << "{\"stepIndex\":0,\"line\":3,\"event\":\"start\",\"variables\":{\"count\":6},\"callStack\":[]}" << std::endl;
        int count = 6;
        return count;
    }

};

int main() {
  std::vector<int> arg0 = std::vector<int>{0, 1, 1, 1, 1, 1, 0, 0, 0};
  Solution sol;
  auto result = sol.findMaxLength(arg0);
  std::cout << result << std::endl;
  return 0;
}
