# AWS Terraform Configuration

Este directorio contiene la configuración Terraform para Amazon Web Services (AWS) que despliega:

- Una instancia de EC2 con Docker y Docker Compose
- Un repositorio ECR para imágenes de Docker
- Grupos de seguridad para controlar el acceso
- Políticas y roles IAM para acceso a servicios

## Requisitos previos

1. Cuenta de AWS con permisos adecuados
2. [AWS CLI](https://aws.amazon.com/cli/) instalado y configurado
3. [Terraform](https://developer.hashicorp.com/terraform/downloads) instalado

## Configuración de SSH para AWS

AWS proporciona un gestor de pares de claves integrado que facilita la configuración de SSH:

### Pasos para configurar SSH:

1. **Crear un par de claves en AWS Console**:
   - Ve a EC2 > Key Pairs > Create Key Pair
   - Dale un nombre (ej: `fiuba-demo`)
   - Descarga el archivo .pem cuando te lo solicite
   - Guarda el archivo en una ubicación segura (ej: `/path/to/fiuba-demo.pem`)

2. **Establece permisos en la clave privada**:
   ```bash
   chmod 400 /path/to/fiuba-demo.pem
   ```

3. **Actualiza tu archivo `terraform.tfvars`**:
   ```
   ssh_key_name = "fiuba-demo"  # Nombre del key pair en AWS Console
   ssh_private_key_path = "/path/to/fiuba-demo.pem"  # Ruta local al archivo .pem
   ```

El código Terraform configurará automáticamente la instancia EC2 para usar esta clave:
- AWS inyecta la clave pública en la instancia durante su creación
- La clave privada (.pem) se usa localmente para que Terraform pueda conectarse a la instancia

## Variables a configurar

Edita el archivo `terraform.tfvars`:

```hcl
ssh_key_name          = "fiuba-demo"           # Nombre del key pair en AWS
ssh_private_key_path  = "/path/to/fiuba-demo.pem" # Ruta a tu clave privada SSH
allowed_ip_cidr       = "0.0.0.0/0"            # CIDR de IPs permitidas (por seguridad, limita a tu IP)
region                = "us-east-1"            # Región AWS
microservice_name     = "product_catalog"      # Nombre del microservicio/repo ECR
disk_size_gb          = 16                      # Tamaño del disco en GB (máximo 30GB para free tier)
```

## Límites del Free Tier

### Almacenamiento
- **Tamaño de disco**: La variable `disk_size_gb` permite configurar el tamaño del volumen de la instancia EC2.
- **Free Tier**: AWS ofrece 30GB de almacenamiento EBS (SSD) en su capa gratuita.
- **Validación**: El código incluye una validación que impide configurar un disco mayor a 30GB para evitar cargos adicionales.
- **Valor predeterminado**: 16GB, suficiente para la mayoría de casos de uso de desarrollo.

## Despliegue

```bash
# Inicializar Terraform
terraform init

# Ver los cambios que se aplicarán
terraform plan

# Aplicar la configuración
terraform apply
```

## Autenticación con ECR

La instancia EC2 está configurada para autenticarse automáticamente con ECR mediante:

1. Un rol IAM adjunto a la instancia que tiene permisos para acceder a ECR
2. Comandos de autenticación en el script de despliegue:
   ```bash
   aws ecr get-login-password --region ${var.region} | docker login --username AWS --password-stdin ${aws_ecr_repository.microservice_repo.repository_url}
   ```

Esto permite que Docker en la instancia EC2 pueda extraer imágenes del repositorio ECR sin credenciales manuales.

## Acceso a la instancia

Después de desplegar, puedes acceder a la instancia usando SSH:

```bash
ssh -i /path/to/fiuba-demo.pem ec2-user@<public_ip>
```

Donde `<public_ip>` es la dirección IP pública mostrada en los outputs después de aplicar la configuración. 