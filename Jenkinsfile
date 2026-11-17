// comπle Editor — Jenkins pipeline
//
// Builds the Linux desktop packages (AppImage + deb) and the browser-accessible
// IDE image inside Docker, smoke-tests the image, then pushes/publishes.
//
// Agent requirements: Linux node labelled "docker" with Docker Engine 23+ (BuildKit),
// curl. No Node.js needed on the agent — everything runs in containers.
//
// Jenkins credentials to create (Manage Jenkins → Credentials):
//   compile-env-file       Secret file      your .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY,
//                                           VITE_PROXY_URL, VITE_APP_SECRET)
//   docker-registry-creds  Username/Pass    registry login (Docker Hub / GHCR token)
//   github-token           Secret text      GitHub PAT with "repo" scope (release publishing)
//
// Windows/macOS installers still come from GitHub Actions (.github/workflows/build.yml):
// they need native Windows/macOS hosts and can't be produced in a Linux container.

pipeline {
  agent { label 'docker' }

  options {
    timestamps()
    timeout(time: 90, unit: 'MINUTES')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '5'))
  }

  parameters {
    string(name: 'REGISTRY', defaultValue: 'docker.io/iamkartik0704',
           description: 'Registry + namespace to push to, e.g. docker.io/<user> or ghcr.io/<user>')
    booleanParam(name: 'PUSH_IMAGE', defaultValue: true,
                 description: 'Push the IDE image (only on main or tags)')
    booleanParam(name: 'PUBLISH_RELEASE', defaultValue: false,
                 description: 'Upload Linux packages to the GitHub release (always on for v* tags)')
  }

  environment {
    DOCKER_BUILDKIT = '1'
    IMAGE_NAME      = 'compile-ide'
  }

  stages {
    stage('Prepare') {
      steps {
        script {
          env.APP_VERSION = sh(returnStdout: true,
            script: '''sed -n 's/^ *"version": *"\\([^"]*\\)".*/\\1/p' package.json | head -n1''').trim()
          env.GIT_SHORT = sh(returnStdout: true, script: 'git rev-parse --short=8 HEAD').trim()
          env.BUILD_TAG_ID  = "${env.APP_VERSION}-${env.BUILD_NUMBER}-${env.GIT_SHORT}"
          env.BUILDER_IMAGE = "${env.IMAGE_NAME}-builder:${env.BUILD_TAG_ID}"
          env.RUNTIME_IMAGE = "${env.IMAGE_NAME}:${env.BUILD_TAG_ID}"
          currentBuild.displayName = "#${env.BUILD_NUMBER} v${env.APP_VERSION} (${env.GIT_SHORT})"
        }
        sh 'docker version && docker buildx version || true'
      }
    }

    stage('Build & Package (Linux)') {
      steps {
        withCredentials([file(credentialsId: 'compile-env-file', variable: 'ENV_FILE')]) {
          // "package" stage = npm ci → electron-vite build → electron-builder --linux
          sh '''
            docker build \
              --target package \
              --secret id=env,src="$ENV_FILE" \
              --label org.opencontainers.image.revision="$GIT_COMMIT" \
              -t "$BUILDER_IMAGE" .
          '''
        }
        sh '''
          rm -rf dist && mkdir -p dist
          cid=$(docker create "$BUILDER_IMAGE")
          docker cp "$cid:/app/dist/." dist/
          docker rm "$cid" >/dev/null
          ls -lh dist
        '''
      }
      post {
        success {
          archiveArtifacts artifacts: 'dist/*.AppImage, dist/*.deb, dist/*.yml', fingerprint: true, allowEmptyArchive: false
        }
      }
    }

    stage('Build IDE image') {
      steps {
        withCredentials([file(credentialsId: 'compile-env-file', variable: 'ENV_FILE')]) {
          // Reuses the cached package stage from the previous step.
          sh '''
            docker build \
              --target runtime \
              --secret id=env,src="$ENV_FILE" \
              --label org.opencontainers.image.version="$APP_VERSION" \
              --label org.opencontainers.image.revision="$GIT_COMMIT" \
              --label org.opencontainers.image.source="https://github.com/iamkartik0704/compile" \
              -t "$RUNTIME_IMAGE" .
          '''
        }
      }
    }

    stage('Smoke test') {
      steps {
        sh 'bash docker/smoke-test.sh "$RUNTIME_IMAGE" 180'
      }
    }

    stage('Push image') {
      when {
        allOf {
          expression { params.PUSH_IMAGE }
          anyOf { branch 'main'; buildingTag() }
        }
      }
      steps {
        withCredentials([usernamePassword(credentialsId: 'docker-registry-creds',
                                          usernameVariable: 'REG_USER', passwordVariable: 'REG_PASS')]) {
          sh '''
            set -e
            REG_HOST="${REGISTRY%%/*}"
            echo "$REG_PASS" | docker login "$REG_HOST" -u "$REG_USER" --password-stdin

            TARGET="$REGISTRY/$IMAGE_NAME"
            for t in "$BUILD_TAG_ID" "$APP_VERSION" latest; do
              docker tag "$RUNTIME_IMAGE" "$TARGET:$t"
              docker push "$TARGET:$t"
            done
          '''
        }
      }
      post {
        always { sh 'docker logout "${REGISTRY%%/*}" || true' }
      }
    }

    stage('Publish GitHub release (Linux)') {
      when {
        anyOf {
          buildingTag()
          expression { params.PUBLISH_RELEASE }
        }
      }
      steps {
        withCredentials([string(credentialsId: 'github-token', variable: 'GH_TOKEN')]) {
          // Uses electron-builder's github provider (same as CI), so latest-linux.yml
          // is uploaded too and electron-updater works for Linux users.
          sh '''
            docker run --rm -e GH_TOKEN "$BUILDER_IMAGE" \
              npx electron-builder --linux AppImage deb --x64 \
                --prepackaged dist/linux-unpacked --publish always
          '''
        }
      }
    }
  }

  post {
    always {
      // Builder image contains compiled VITE_* values — never keep it around.
      sh '''
        docker rmi -f "$BUILDER_IMAGE" "$RUNTIME_IMAGE" >/dev/null 2>&1 || true
        docker image prune -f --filter "until=24h" >/dev/null 2>&1 || true
      '''
    }
    success { echo "✓ comπle Editor v${env.APP_VERSION} built (${env.BUILD_TAG_ID})" }
    failure { echo '✗ Build failed — check the stage logs above' }
  }
}
