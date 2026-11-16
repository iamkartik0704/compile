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

## Run in Docker (browser-based IDE)

The image runs the Linux build of comπle on a virtual display and streams it to your browser via noVNC. It ships with g++/gdb, clangd, Python 3 + debugpy, JDK 17, Node 22 and git.

```bash
# .env must contain the VITE_* values (passed as a BuildKit secret, never baked into a layer)
docker compose up --build            # then open http://localhost:6080
VNC_PASSWORD=changeme docker compose up -d   # password-protect the session
```

- Projects: `./workspace` on the host → `/home/ide/workspace` in the IDE
- Settings / API keys persist in the `compile-config` volume
- Linux packages only: `docker build --secret id=env,src=.env --target artifacts --output type=local,dest=dist .`
- Smoke-test an image: `bash docker/smoke-test.sh compile-ide:latest`

## CI (Jenkins)

`Jenkinsfile` builds the AppImage + .deb, builds and smoke-tests the IDE image, pushes it (main / tags) and publishes Linux assets to the GitHub release on `v*` tags. Needs a Linux agent labelled `docker` and the credentials `compile-env-file`, `docker-registry-creds`, `github-token` (see the header of the Jenkinsfile). Windows/macOS installers stay on GitHub Actions.
