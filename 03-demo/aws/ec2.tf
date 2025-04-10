# EC2 instance setup with Docker installation via user data
resource "aws_instance" "docker_instance" {
  ami                    = data.aws_ssm_parameter.latest_ami.value
  instance_type          = "t2.micro"
  key_name               = var.ssh_key_name
  iam_instance_profile   = aws_iam_instance_profile.ec2_instance_profile.name
  security_groups        = [aws_security_group.ec2_sg.name]

  user_data = <<-EOF
    #!/bin/bash
    # Update packages
    yum update -y

    # Install Docker via official script
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh

    # Add ec2-user to docker group
    usermod -aG docker ec2-user

    # Enable and start Docker
    systemctl enable docker
    systemctl start docker

    # Create directory for apps and set permissions
    mkdir -p /opt/apps
    chown -R ec2-user:ec2-user /opt/apps
  EOF

  tags = {
    Name = "DockerComposeInstance"
  }

  # Copy Docker Compose YAML to EC2 instance
  provisioner "file" {
    source      = "../compose.infra.yaml"
    destination = "/opt/apps/compose.infra.yaml"

    connection {
      type        = "ssh"
      user        = "ec2-user"
      host        = self.public_ip
      private_key = file(pathexpand(var.ssh_private_key_path))
    }
  }

  # Run Docker Compose
  provisioner "remote-exec" {
    inline = [
      "cd /opt/apps",
      "docker compose up -f compose.infra.yaml -d"
    ]

    connection {
      type        = "ssh"
      user        = "ec2-user"
      host        = self.public_ip
      private_key = file(pathexpand(var.ssh_private_key_path))
    }
  }
}
