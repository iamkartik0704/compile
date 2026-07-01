// Global extension registry
export const EXTENSIONS = [
  // 1. Core language LSPs, dependencies and debugging
  { 
    id: 'ext-lsp-typescript', name: 'TypeScript Language Features', category: 'language', 
    description: 'Provides rich language support for JavaScript and TypeScript.', 
    longDescription: 'TypeScript Language Features provides comprehensive support for JavaScript and TypeScript development.',
    author: 'IDE Core', installed: true, enabled: true 
  },
  { 
    id: 'ext-lsp-python', name: 'Python (Pyright)', category: 'language', 
    description: 'IntelliSense, linting, and refactoring for Python.', 
    longDescription: 'A static type checker and language server for Python, developed by Microsoft.',
    author: 'IDE Core', installed: true, enabled: true 
  },
  { 
    id: 'ext-lsp-java', name: 'Language Support for Java', category: 'language', 
    description: 'Java Linting, IntelliSense, formatting, refactoring.', 
    longDescription: 'Provides Java support for your IDE using the Eclipse JDT Language Server.',
    author: 'IDE Core', installed: false, enabled: false 
  },
  { 
    id: 'ext-dbg-chrome', name: 'Debugger for Chrome', category: 'debugging', 
    description: 'Debug your JavaScript code in the Chrome browser.', 
    longDescription: 'Debug your JavaScript code running in Google Chrome from your IDE.',
    author: 'IDE Core', installed: false, enabled: false 
  },
  
  // 2. Code formatting and linting
  { 
    id: 'ext-fmt-prettier', name: 'Prettier - Code formatter', category: 'linters', 
    description: 'Code formatter using prettier.', 
    longDescription: 'Prettier is an opinionated code formatter. It enforces a consistent style by parsing your code.',
    author: 'IDE Core', installed: true, enabled: true 
  },
  { 
    id: 'ext-fmt-eslint', name: 'ESLint', category: 'linters', 
    description: 'Integrates ESLint JavaScript into the IDE.', 
    longDescription: 'The ESLint extension statically analyzes your code to quickly find problems.',
    author: 'IDE Core', installed: false, enabled: false 
  },

  { 
    id: 'ext-fmt-errorlens', name: 'Error Lens', category: 'linters', 
    description: 'Improve highlighting of errors, warnings and other language diagnostics.', 
    longDescription: 'ErrorLens turbos charges language diagnostic features by making diagnostics stand out more prominently.',
    author: 'Community', installed: false, enabled: false 
  },
  
  // 3. Git and version control
  { 
    id: 'ext-git-lens', name: 'GitLens — Git supercharged', category: 'git', 
    description: 'Supercharge Git within your IDE.', 
    longDescription: 'GitLens supercharges Git inside your editor. It helps you to visualize code authorship at a glance.',
    author: 'Community', installed: false, enabled: false 
  },
  { 
    id: 'ext-git-graph', name: 'Git Graph', category: 'git', 
    description: 'View a Git Graph of your repository.', 
    longDescription: 'View a Git Graph of your repository, and easily perform Git actions from the graph.',
    author: 'Community', installed: false, enabled: false 
  },
  // 4. Productivity and dev experience
  { 
    id: 'ext-prod-docker', name: 'Docker', category: 'productivity', 
    description: 'Create, manage, and debug containerized applications.', 
    longDescription: 'The Docker extension makes it easy to build, manage, and deploy containerized applications.',
    author: 'IDE Core', installed: false, enabled: false 
  },
  { 
    id: 'ext-prod-k8s', name: 'Kubernetes', category: 'productivity', 
    description: 'Develop, deploy and debug Kubernetes applications.', 
    longDescription: 'Develop, deploy and debug Kubernetes applications. View logs, shell into pods, and manage clusters.',
    author: 'IDE Core', installed: false, enabled: false 
  },
  { 
    id: 'ext-prod-postman', name: 'Postman', category: 'productivity', 
    description: 'API client for testing and development.', 
    longDescription: 'The Postman extension enables you to develop, test, and document your APIs directly from your editor.',
    author: 'Community', installed: false, enabled: false 
  },
  { 
    id: 'ext-prod-liveserver', name: 'Live Server', category: 'productivity', 
    description: 'Launch a local development server with live reload feature.', 
    longDescription: 'Launch a local development server with live reload feature for static & dynamic pages.',
    author: 'Community', installed: false, enabled: false 
  },
  { 
    id: 'ext-prod-projmgr', name: 'Project Manager', category: 'productivity', 
    description: 'Easily switch between projects.', 
    longDescription: 'Project Manager helps you to easily access your projects, no matter where they are located.',
    author: 'Community', installed: false, enabled: false 
  },
  
  // 5. Remote development
  { 
    id: 'ext-rem-ssh', name: 'Remote - SSH', category: 'remote', 
    description: 'Open any folder on a remote machine using SSH.', 
    longDescription: 'The Remote - SSH extension lets you use any remote machine with a SSH server as your development environment.',
    author: 'IDE Core', installed: false, enabled: false 
  },
  { 
    id: 'ext-rem-containers', name: 'Dev Containers', category: 'remote', 
    description: 'Open any folder inside (or mounted into) a container.', 
    longDescription: 'The Dev Containers extension lets you use a Docker container as a full-featured development environment.',
    author: 'IDE Core', installed: false, enabled: false 
  },
  
  // Themes
  {
    id: 'theme-compile-dark', name: 'comπle Dark Theme', category: 'theme',
    description: 'The original comπle editor dark theme.',
    longDescription: 'The official dark theme of comπle Editor, featuring a dark olive/gray background.',
    author: 'IDE Core', installed: true, enabled: true,
  },
  {
    id: 'theme-dark-plus', name: 'Dark Plus Theme', category: 'theme',
    description: 'Default dark theme based on standard IDEs.',
    longDescription: 'A familiar, high-contrast dark theme that closely matches the default look of popular code editors.',
    author: 'IDE Core', installed: false, enabled: false,
  },
  { 
    id: 'theme-light-modern', name: 'Light Modern Theme', category: 'theme', 
    description: 'Clean, modern light theme.', 
    longDescription: 'A bright, low-contrast modern light theme designed to reduce eye strain.',
    author: 'IDE Core', installed: true, enabled: false 
  },
  { 
    id: 'theme-dracula', name: 'Dracula Official', category: 'theme', 
    description: 'Dark theme for many editors, shells, and more.', 
    longDescription: 'Dracula is a color scheme and UI theme tailored for code editors and terminal emulators.',
    author: 'Community', installed: true, enabled: false 
  }
]

export function getExtensionsByCategory() {
  const grouped = {}
  EXTENSIONS.forEach(ext => {
    if (!grouped[ext.category]) grouped[ext.category] = []
    grouped[ext.category].push(ext)
  })
  return grouped
}
