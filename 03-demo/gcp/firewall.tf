# Firewall rule for SSH access
resource "google_compute_firewall" "ssh" {
  name    = "allow-ssh"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = [var.allowed_ip_cidr]
  target_tags   = ["pipeline"]
}

# Firewall rule for HTTP access
resource "google_compute_firewall" "http" {
  name    = "allow-http"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["80"]
  }

  source_ranges = [var.allowed_ip_cidr]
  target_tags   = ["pipeline"]
}

# Firewall rule for Traefik Dashboard access
resource "google_compute_firewall" "traefik_dashboard" {
  name    = "allow-traefik-dashboard"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["8080"]
  }

  source_ranges = [var.allowed_ip_cidr]
  target_tags   = ["pipeline"]
}

# Firewall rule for Jaeger Dashboard access
resource "google_compute_firewall" "jaeger_dashboard" {
  name    = "allow-jaeger-dashboard"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["16686"]
  }

  source_ranges = [var.allowed_ip_cidr]
  target_tags   = ["pipeline"]
} 