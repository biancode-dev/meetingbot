# terraform

We use workspaces for non-prod and prod environments.

The prod environment should always be the default workspace, to make deploying to self-hosted infrastructure easy.

## Getting started

Run `terraform init -backend-config=backend.tfvars`
