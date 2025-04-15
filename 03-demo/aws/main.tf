provider "aws" {
  region = var.region
  profile = var.aws_profile
}

# Fetch latest Amazon Linux AMI from AWS SSM
data "aws_ssm_parameter" "latest_ami" {
  name = var.ami_ssm_path
}
