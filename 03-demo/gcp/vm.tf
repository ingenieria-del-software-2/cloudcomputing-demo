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

  # Attach service account with proper permissions
  service_account {
    email  = google_service_account.pipeline_vm_sa.email
    scopes = ["cloud-platform"]
  }

  metadata_startup_script = <<-EOF
    #!/bin/bash
    # Update packages
    apt update -y

    # Install necessary tools
    apt install -y apt-transport-https ca-certificates gnupg curl

    # Install gcloud CLI
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key --keyring /usr/share/keyrings/cloud.google.gpg add -
    apt update -y && apt install -y google-cloud-cli

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
    chmod 777 /opt/apps
    chown -R debian:debian /opt/apps
    
    # Configure Docker credential helper for permanent authentication
    mkdir -p /home/debian/.docker
    echo '{"credHelpers": {"${var.region}-docker.pkg.dev": "gcloud"}}' > /home/debian/.docker/config.json
    chown -R debian:debian /home/debian/.docker
  EOF

  tags = ["pipeline"]

  # Wait for instance to be ready before provisioning
  provisioner "remote-exec" {
    inline = [
      "echo 'Waiting for startup script to complete...'",
      "while [ ! -f /var/lib/cloud/instance/boot-finished ]; do sleep 5; echo 'Waiting for startup to finish...'; done"
    ]

    connection {
      type        = "ssh"
      user        = "debian"
      host        = self.network_interface[0].access_config[0].nat_ip
      private_key = file(pathexpand(var.ssh_private_key_path))
    }
  }
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
      "echo 'Waiting for Docker to be installed and available...'",
      "sudo systemctl is-active docker || sudo systemctl start docker",
      "while ! docker info > /dev/null 2>&1; do sleep 5; echo 'Waiting for Docker to be ready...'; done",
      "cd /opt/apps",
      "echo 'Ensuring traefik-shared network exists...'",
      "docker network inspect traefik-shared >/dev/null 2>&1 || docker network create traefik-shared",
      "docker compose -f compose.infra.yaml up -d"
    ]

    connection {
      type        = "ssh"
      user        = "debian"
      host        = self.network_interface[0].access_config[0].nat_ip
      private_key = file(pathexpand(var.ssh_private_key_path))
    }
  }
}
