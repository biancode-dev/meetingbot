provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
  default_tags {
    tags = {
      Service     = "MeetingBot"
      Environment = terraform.workspace == "prod" ? "Prod" : (terraform.workspace == "stage" ? "Stage" : "Dev")
    }
  }
}

data "aws_availability_zones" "available" {}

locals {
  name = "meetingbot-${terraform.workspace}"

  azs = slice(data.aws_availability_zones.available.names, 0, 3)

  current_commit_sha_short = "d09f8f1"

  prod = terraform.workspace == "prod"
}

terraform {
  backend "s3" {
    encrypt = true
  }
}
