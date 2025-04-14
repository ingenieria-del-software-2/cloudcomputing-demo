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
    ssh-keys       = "luiscusihuaman88:${file(pathexpand(var.ssh_public_key_path))}"
  }

  metadata_startup_script = <<-EOF
    #!/bin/bash
    # Update packages
    # apt update -y

    # # Create directory for Docker Compose apps and set permissions first
    # mkdir -p /opt/apps
    # chmod 777 /opt/apps
    # chown -R luiscusihuaman88:luiscusihuaman88 /opt/apps

    # Install Google Cloud SDK
    curl -sSL https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz | tar -xz && ./google-cloud-sdk/install.sh --quiet
    
    # Install Docker via official Docker script
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker

    # # Add user to docker group
    usermod -aG docker luiscusihuaman88
    
    # # Configure Docker credential helper for permanent authentication
    mkdir -p /home/luiscusihuaman88/.docker
    echo '{"credHelpers": {"${var.region}-docker.pkg.dev": "gcloud"}}' > /home/luiscusihuaman88/.docker/config.json
    chown -R luiscusihuaman88:luiscusihuaman88 /home/luiscusihuaman88/.docker
  EOF

  tags = ["pipeline"]


  provisioner "file" {
    source      = "../compose.infra.yaml"
    destination = "/opt/apps/compose.infra.yaml"

    connection {
      type        = "ssh"
      user        = local.username
      host        = self.network_interface[0].access_config[0].nat_ip
      private_key = file(pathexpand(var.ssh_private_key_path))
    }
  }

  # Ejecutar Docker Compose automáticamente
  # provisioner "remote-exec" {
  #   inline = [
  #     "echo 'Waiting for Docker to be installed and available...'",
  #     "sudo systemctl is-active docker || sudo systemctl start docker",
  #     "while ! docker info > /dev/null 2>&1; do sleep 5; echo 'Waiting for Docker to be ready...'; done",
  #     "cd /opt/apps",
  #     "echo 'Ensuring traefik-shared network exists...'",
  #     "docker network inspect traefik-shared >/dev/null 2>&1 || docker network create traefik-shared",
  #     "docker compose -f compose.infra.yaml up -d"
  #   ]

  #   connection {
  #     type        = "ssh"
  #     user        = local.username
  #     host        = self.network_interface[0].access_config[0].nat_ip
  #     private_key = file(pathexpand(var.ssh_private_key_path))
  #   }
  # }
}
