# Configure AWS Provider
provider "aws" {
  region = var.region
}

# Fetch latest Amazon Linux AMI from AWS SSM
data "aws_ssm_parameter" "latest_ami" {
  name = var.ami_ssm_path
}
