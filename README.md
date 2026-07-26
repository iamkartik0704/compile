# comπle Editor

A secure Electron IDE with AI streaming.

## macOS Installation

If you are installing the application on macOS, you may encounter an "App is damaged and can't be opened" error. This is because the application is currently unsigned.

To bypass this and run the application, open your Terminal and run the following command to clear the quarantine attributes:

```bash
xattr -cr /Applications/compile-editor.app
```
*(If you installed the app in a different location, replace `/Applications/compile-editor.app` with the correct path)*

After running this command, you will be able to launch the application normally.
