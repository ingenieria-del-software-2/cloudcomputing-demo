# AWS region
variable "region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

# AMI path in SSM Parameter Store
variable "ami_ssm_path" {
  description = "SSM path to retrieve latest Amazon Linux AMI"
  type        = string
  default     = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# Allowed CIDR block for SSH, HTTP, and dashboards
variable "allowed_ip_cidr" {
  description = "CIDR block allowed to access SSH, HTTP, Traefik, and Jaeger"
  type        = string
  default     = "0.0.0.0/0"
}

# SSH key pair name for EC2 instance
variable "ssh_key_name" {
  description = "Existing AWS SSH key pair name"
  type        = string
}

# Path to local SSH private key for provisioners
variable "ssh_private_key_path" {
  description = "Local path to the SSH private key (.pem)"
  type        = string
  default     = "~/.ssh/your_key.pem"
}

variable "microservice_name" {
  description = "Nombre del microservicio (usado como nombre del repositorio ECR)"
  type        = string
}
