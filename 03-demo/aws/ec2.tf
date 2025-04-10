# EC2 instance setup with Docker installation via user data
resource "aws_instance" "docker_instance" {
  ami                    = data.aws_ssm_parameter.latest_ami.value
  instance_type          = "t2.micro"
  key_name               = var.ssh_key_name
  iam_instance_profile   = aws_iam_instance_profile.ec2_instance_profile.name
  security_groups        = [aws_security_group.ec2_sg.name]

  user_data = <<-EOF
    #!/bin/bash
    yum update -y
    amazon-linux-extras install docker -y
    yum install docker -y
    usermod -aG docker ec2-user
    systemctl enable docker
    systemctl start docker

    mkdir -p ~/.docker/cli-plugins
    curl -SL https://github.com/docker/compose/releases/download/v2.27.0/docker-compose-linux-x86_64 -o /usr/libexec/docker/cli-plugins/docker-compose
    chmod +x /usr/libexec/docker/cli-plugins/docker-compose

    # Create directory for apps and set permissions
    mkdir -p /opt/apps
    chmod 777 /opt/apps
    chown -R ec2-user:ec2-user /opt/apps
  EOF

  tags = {
    Name = "DockerComposeInstance"
  }

  # Wait for instance to be ready before provisioning
  provisioner "remote-exec" {
    inline = [
      "echo 'Waiting for user data script to complete...'",
      "sudo cloud-init status --wait"
    ]

    connection {
      type        = "ssh"
      user        = "ec2-user"
      host        = self.public_ip
      private_key = file(pathexpand(var.ssh_private_key_path))
    }
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
      "echo 'Waiting for Docker to be installed and available...'",
      "sudo systemctl is-active docker || sudo systemctl start docker",
      "while ! sudo docker info > /dev/null 2>&1; do sleep 5; echo 'Waiting for Docker to be ready...'; done",
      "cd /opt/apps",
      "sudo docker compose -f compose.infra.yaml up -d"
    ]

    connection {
      type        = "ssh"
      user        = "ec2-user"
      host        = self.public_ip
      private_key = file(pathexpand(var.ssh_private_key_path))
    }
  }
}
