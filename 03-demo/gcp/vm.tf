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
      size  = var.disk_size_gb
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
    set -e

    # Crear directorio para apps Docker y permisos
    mkdir -p /opt/apps
    chmod 777 /opt/apps
    chown -R ${local.username}:${local.username} /opt/apps

    # Instalar Google Cloud SDK
    curl -sSL https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/google-cloud-cli-linux-x86_64.tar.gz | tar -xz
    ./google-cloud-sdk/install.sh --quiet

    # Instalar Docker en Debian 12
    apt-get update && apt-get install -y ca-certificates curl gnupg
    mkdir -p /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg | tee /etc/apt/keyrings/docker.asc > /dev/null
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
      https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    # # Add user to docker group
    usermod -aG docker ${local.username}
    
    # # Configure Docker credential helper for permanent authentication
    mkdir -p /home/${local.username}/.docker
    echo '{"credHelpers": {"${var.region}-docker.pkg.dev": "gcloud"}}' > /home/${local.username}/.docker/config.json
    chown -R ${local.username}:${local.username} /home/${local.username}/.docker
    echo "DONE" > /var/log/startup-script-done
  EOF

  tags = ["pipeline"]

  # Copiar archivo compose.infra.yaml
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

  # Espera a que el script de arranque termine
  provisioner "remote-exec" {
    inline = [
      "echo '😴 Waiting for startup script to finish...'",
      # ⚠️ 7 MINUTES TAKES TO FINISH ⚠️
      "until [ -f /var/log/startup-script-done ]; do sleep 2; echo '🕑 Waiting for startup script... (7 min total)'; done",
      "echo '✅ Startup script completed.'",
    ]

    connection {
      type        = "ssh"
      user        = local.username
      host        = self.network_interface[0].access_config[0].nat_ip
      private_key = file(pathexpand(var.ssh_private_key_path))
    }
  }
  # Ejecutar Docker Compose
    provisioner "remote-exec" {
    inline = [
      "cd /opt/apps",
      "echo '🌐 Creating traefik-shared network...'",
      "docker network inspect traefik-shared >/dev/null 2>&1 || docker network create traefik-shared",
      "echo '🐳 Starting services...'",
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
