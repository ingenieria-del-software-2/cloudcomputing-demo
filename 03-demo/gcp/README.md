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

Esto permite que Docker en la VM pueda extraer imágenes del repositorio sin tokens manuales.

## Cambio entre cuentas de Google Cloud

Si necesitas cambiar de una cuenta de Google Cloud (por ejemplo, de una cuenta laboral a una personal), sigue estos pasos:

### Verificar la cuenta actual

Para ver qué cuenta está actualmente configurada:

```bash
gcloud auth list
```

Esto mostrará todas las cuentas autenticadas, con un asterisco (*) junto a la cuenta activa.

### Cambiar a otra cuenta

1. **Autenticarse con la nueva cuenta**:

   ```bash
   gcloud auth login
   ```

   Se abrirá una ventana del navegador para que inicies sesión con la cuenta deseada.

2. **Establecer la cuenta como activa**:

   ```bash
   gcloud config set account [TU_CORREO@gmail.com]
   ```

   Reemplaza `[TU_CORREO@gmail.com]` con tu dirección de correo electrónico.

3. **Listar los proyectos disponibles**:

   ```bash
   gcloud projects list
   ```

4. **Configurar el proyecto activo**:

   ```bash
   gcloud config set project [ID_DEL_PROYECTO]
   ```

   Reemplaza `[ID_DEL_PROYECTO]` con el ID del proyecto que deseas usar.

5. **Actualizar las credenciales de aplicación predeterminadas**:

   ```bash
   gcloud auth application-default login
   ```

   Esto configura las credenciales que usarán las bibliotecas de cliente de Google Cloud.

6. **Verificar la configuración completa**:

   ```bash
   gcloud config list
   ```

   Esto mostrará tu cuenta activa, proyecto y otras configuraciones.

7. **Actualizar el archivo terraform.tfvars**:

   Modifica la línea `project_id` en tu archivo `terraform.tfvars` para que coincida con tu nuevo proyecto:

   ```
   project_id = "tu-nuevo-proyecto-id"
   ```

Después de completar estos pasos, podrás desplegar recursos en GCP usando tu cuenta personal y el proyecto seleccionado.

## Configuración de SSH para GCP (diferente a AWS)

**IMPORTANTE**: A diferencia de AWS, GCP no tiene un gestor de pares de claves integrado. Debes generar y configurar tus propias claves SSH.

## ⚠️ APIs de Google Cloud requeridas

Para que el pipeline de despliegue en GCP funcione correctamente, debes habilitar las siguientes APIs en tu proyecto de Google Cloud:

- **Compute Engine API** - Para el despliegue y gestión de VMs
- **IAM Credentials API** - Para la autenticación y autorización del Service Account

Puedes habilitar estas APIs desde la consola de Google Cloud o usando el siguiente comando:

```bash
gcloud services enable compute.googleapis.com iamcredentials.googleapis.com
```

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
vm_machine_type     = "e2-micro"               # Tipo de máquina para la VM
disk_size_gb        = 16                       # Tamaño del disco en GB (máximo 30GB para free tier)
ssh_private_key_path = "~/.ssh/gcp-key"        # Ruta a tu clave privada SSH
ssh_public_key_path = "~/.ssh/gcp-key.pub"     # Ruta a tu clave pública SSH
allowed_ip_cidr     = "0.0.0.0/0"              # CIDR de IPs permitidas (por seguridad, limita a tu IP)
```

## Límites del Free Tier

### Almacenamiento
- **Tamaño de disco**: La variable `disk_size_gb` permite configurar el tamaño del disco de arranque de la VM.
- **Free Tier**: GCP ofrece 30GB de almacenamiento en disco estándar (pd-standard) en su capa gratuita.
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

## Autenticación con Artifact Registry

La VM está configurada para autenticarse automáticamente con Artifact Registry usando:

1. La cuenta de servicio de la VM con permisos de lectura
2. El helper de credenciales de Docker configurado para GCP
