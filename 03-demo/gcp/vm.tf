# vm.tf

# Recurso VM equivalente al setup de AWS EC2 con Docker Compose
resource "google_compute_instance" "pipeline_vm" {
  name         = var.vm_name
  machine_type = var.vm_machine_type
  zone         = var.zone

  boot_disk {
    initialize_params {
      image = "projects/debian-cloud/global/images/family/debian-12"
    }
  }

  network_interface {
    network = "default"
    access_config {}
  }

  metadata_startup_script = <<-EOF
    #!/bin/bash
    # Update packages
    apt update -y

    # Install Docker via official Docker script
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh

    # Add 'debian' user to docker group
    usermod -aG docker debian

    # Enable and start Docker
    systemctl enable docker
    systemctl start docker

    # Create directory for Docker Compose apps and set permissions
    mkdir -p /opt/apps
    chown -R debian:debian /opt/apps
  EOF

  tags = ["pipeline"]

  # Copiar archivo Docker Compose a la VM
  provisioner "file" {
    source      = "../compose.infra.yaml"
    destination = "/opt/apps/compose.infra.yaml"

    connection {
      type        = "ssh"
      user        = "debian"
      host        = self.network_interface[0].access_config[0].nat_ip
      private_key = file(pathexpand(var.ssh_private_key_path))
    }
  }

  # Ejecutar Docker Compose automáticamente
  provisioner "remote-exec" {
    inline = [
      "cd /opt/apps",
      "docker compose up -f compose.infra.yaml -d"
    ]

    connection {
      type        = "ssh"
      user        = "debian"
      host        = self.network_interface[0].access_config[0].nat_ip
      private_key = file(pathexpand(var.ssh_private_key_path))
    }
  }
}
