# Variables
variable "region" {
  description = "AWS Region"
  type        = string
  default     = "us-east-1"
}

variable "ami_id" {
  description = "AMI for EC2 instance"
  type        = string
  default     = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

variable "ssh_and_web_location" {
  description = "The IP address range that can be used to SSH to the EC2 instances"
  type        = string
  default     = "0.0.0.0/0"
}

variable "ssh_key_name" {
  description = "The SSH key pair to use for the EC2 instance"
  type        = string
}

# Provider
provider "aws" {
  region = var.region
  profile = "iamadmin-general"
}

# Data Source for AMI from SSM Parameter Store
data "aws_ssm_parameter" "ami" {
  name = var.ami_id
}

# Security Group for EC2 Instance
resource "aws_security_group" "instance_sg" {
  description = "Enable SSH access via port 22 and HTTP via port 80"
  
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.ssh_and_web_location]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.ssh_and_web_location]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# IAM Role and Instance Profile for SSM
resource "aws_iam_role" "session_manager_role" {
  name = "session_manager_role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_instance_profile" "session_manager_instance_profile" {
  role = aws_iam_role.session_manager_role.name
}

resource "aws_iam_policy_attachment" "ssm_policy_attachment" {
  name       = "ssm_policy_attachment"
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
  roles      = [aws_iam_role.session_manager_role.name]
}

# EC2 Instance with User Data for NGINX Installation
resource "aws_instance" "ec2_instance" {
  ami                    = data.aws_ssm_parameter.ami.value
  instance_type          = "t2.micro"
  key_name               = var.ssh_key_name
  iam_instance_profile   = aws_iam_instance_profile.session_manager_instance_profile.name
  security_groups        = [aws_security_group.instance_sg.name]

  user_data = <<-EOF
    #!/bin/bash
    yum update -y 
    yum install -y nginx

    cat > /usr/share/nginx/html/index.html <<'EOF_HTML'
    ${templatefile("${path.module}/index.html", {})}
    EOF_HTML

    systemctl enable --now nginx
  EOF

    tags = {
      Name = "MyEC2Instance"
    }
  }

# Outputs
output "instance_id" {
  description = "InstanceId of the newly created EC2 instance"
  value       = aws_instance.ec2_instance.id
}

output "availability_zone" {
  description = "Availability Zone of the newly created EC2 instance"
  value       = aws_instance.ec2_instance.availability_zone
}

output "public_dns" {
  description = "Public DNS of the newly created EC2 instance"
  value       = aws_instance.ec2_instance.public_dns
}

output "public_ip" {
  description = "Public IP address of the newly created EC2 instance"
  value       = aws_instance.ec2_instance.public_ip
}
