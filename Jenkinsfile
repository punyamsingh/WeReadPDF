// Quality gate ("decency") pipeline for WeReadPDF.
// Installs deps with the pinned pnpm version, then runs eslint, a Prettier
// format check, and a production build. Any stage that fails fails the build.
pipeline {
  // Run inside a Node container so the agent doesn't need Node/pnpm preinstalled.
  agent {
    docker {
      image 'node:22-bookworm-slim'
      // Run as root so corepack can write the pnpm shim into the image.
      args '-u root:root'
    }
  }

  options {
    disableConcurrentBuilds()
    timeout(time: 20, unit: 'MINUTES')
  }

  environment {
    CI = 'true'
  }

  stages {
    stage('Setup') {
      steps {
        // Activate the exact pnpm version this repo is pinned to.
        sh 'corepack enable'
        sh 'corepack prepare pnpm@10.11.0 --activate'
        // Fail if the lockfile is out of sync with package.json.
        sh 'pnpm install --frozen-lockfile'
      }
    }

    stage('Lint') {
      steps {
        sh 'pnpm lint'
      }
    }

    stage('Format check') {
      steps {
        // Fails if any file is not formatted to the Prettier config.
        sh 'pnpm format:check'
      }
    }

    stage('Build') {
      steps {
        sh 'pnpm build'
      }
    }
  }

  post {
    always {
      // deleteDir() is a core step (no Workspace Cleanup plugin needed).
      deleteDir()
    }
  }
}
