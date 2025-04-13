# GCP Terraform Configuration

Este directorio contiene la configuración Terraform para Google Cloud Platform (GCP) que despliega:

- Una instancia de VM con Docker y Docker Compose
- Un repositorio de Artifact Registry para imágenes de Docker
- Reglas de firewall
- Cuentas de servicio IAM y permisos

## Requisitos previos

1. Cuenta de GCP con facturación habilitada
2. [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) instalado y configurado
3. [Terraform](https://developer.hashicorp.com/terraform/downloads) instalado

## Configuración de SSH para GCP (diferente a AWS)

**IMPORTANTE**: A diferencia de AWS, GCP no tiene un gestor de pares de claves integrado. Debes generar y configurar tus propias claves SSH.

### Pasos para configurar SSH:

1. **Genera un par de claves SSH** si no tienes uno:
   ```bash
   ssh-keygen -t rsa -f ~/.ssh/gcp-key -C debian
   ```
   Esto creará:
   - `~/.ssh/gcp-key` (clave privada)
   - `~/.ssh/gcp-key.pub` (clave pública)

2. **Actualiza tu archivo `terraform.tfvars`**:
   ```
   ssh_private_key_path = "~/.ssh/gcp-key"
   ssh_public_key_path = "~/.ssh/gcp-key.pub"
   ```

3. **Asegúrate de que ambos archivos existen** en las rutas especificadas.

El código Terraform configurará automáticamente la VM para usar esta clave:
- La clave pública se instala en la VM para permitir acceso
- La clave privada se usa localmente para que Terraform pueda conectarse a la VM

## Variables a configurar

Edita el archivo `terraform.tfvars`:

```hcl
project_id          = "tu-proyecto-id-de-gcp"  # Obligatorio: ID de tu proyecto GCP
region              = "us-central1"            # Región GCP
zone                = "us-central1-a"          # Zona GCP
microservice_name   = "product_catalog"        # Nombre del microservicio/repo
ssh_private_key_path = "~/.ssh/gcp-key"        # Ruta a tu clave privada SSH
ssh_public_key_path = "~/.ssh/gcp-key.pub"     # Ruta a tu clave pública SSH
allowed_ip_cidr     = "0.0.0.0/0"              # CIDR de IPs permitidas (por seguridad, limita a tu IP)
```

## Despliegue

```bash
# Inicializar Terraform
terraform init

# Ver los cambios que se aplicarán
terraform plan

# Aplicar la configuración
terraform apply
```

## Autenticación con Artifact Registry

La VM está configurada para autenticarse automáticamente con Artifact Registry usando:

1. La cuenta de servicio de la VM con permisos de lectura
2. El helper de credenciales de Docker configurado para GCP

Esto permite que Docker en la VM pueda extraer imágenes del repositorio sin tokens manuales. 