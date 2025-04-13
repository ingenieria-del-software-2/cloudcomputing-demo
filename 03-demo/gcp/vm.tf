# vm.tf

# Obtener información del usuario autenticado
data "google_client_openid_userinfo" "me" {}

# Función local para extraer el nombre de usuario base del email
locals {
  username = split("@", data.google_client_openid_userinfo.me.email)[0]
}

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

  # Configurar acceso SSH con el usuario detectado automáticamente
  metadata = {
    enable-oslogin = "FALSE"
    ssh-keys       = "${local.username}:${file(pathexpand(var.ssh_public_key_path))}"
  }

  metadata_startup_script = <<-EOF
    #!/bin/bash
    # Update packages
    apt update -y

    # Create directory for Docker Compose apps and set permissions first
    mkdir -p /opt/apps
    chmod 777 /opt/apps
    chown -R ${local.username}:${local.username} /opt/apps

    # Install necessary tools
    apt install -y apt-transport-https ca-certificates gnupg curl

    # Install gcloud CLI
    echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | apt-key --keyring /usr/share/keyrings/cloud.google.gpg add -
    apt update -y && apt install -y google-cloud-cli

    # Install Docker via official Docker script
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh

    # Add user to docker group
    usermod -aG docker ${local.username}

    # Enable and start Docker
    systemctl enable docker
    systemctl start docker
    
    # Configure Docker credential helper for permanent authentication
    mkdir -p /home/${local.username}/.docker
    echo '{"credHelpers": {"${var.region}-docker.pkg.dev": "gcloud"}}' > /home/${local.username}/.docker/config.json
    chown -R ${local.username}:${local.username} /home/${local.username}/.docker
  EOF

  tags = ["pipeline"]


  provisioner "file" {
    source      = "../compose.infra.yaml"
    destination = "/home/${local.username}/compose.infra.yaml"

    connection {
      type        = "ssh"
      user        = local.username
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
      "sudo mkdir -p /opt/apps",
      "sudo cp /home/${local.username}/compose.infra.yaml /opt/apps/compose.infra.yaml",
      "sudo chmod 644 /opt/apps/compose.infra.yaml",
      "cd /opt/apps",
      "echo 'Ensuring traefik-shared network exists...'",
      "docker network inspect traefik-shared >/dev/null 2>&1 || docker network create traefik-shared",
      "docker compose -f compose.infra.yaml up -d"
    ]

    connection {
      type        = "ssh"
      user        = local.username
      host        = self.network_interface[0].access_config[0].nat_ip
      private_key = file(pathexpand(var.ssh_private_key_path))
    }
  }
}
