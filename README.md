## Generating Image Pull Secret for Private Container Registry

If you need to pull images from a private registry (such as ghcr.io), you must create a Kubernetes secret and add it to the `mytube` namespace.

### 1. Create the Secret

Replace `<your-username>`, `<your-password-or-token>`, and `<your-email>` with your actual registry credentials:

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=<your-username> \
  --docker-password=<your-password-or-token> \
  --docker-email=<your-email> \
  --namespace=mytube
```

### 2. Verify the Secret

```bash
kubectl get secret ghcr-secret --namespace=mytube
```

### 3. Reference the Secret in your Helm values

The `values.yaml` is already configured to use this secret:

```yaml
global:
  imagePullSecrets:
    - name: ghcr-secret
```

This ensures your deployments in the `mytube` namespace can pull images from the private registry.

## Installing with MinIO Secrets (without putting them in values.yaml)

To avoid storing your MinIO credentials in `values.yaml` or in version control, you can provide them at install/upgrade time using `--set`:

```bash
helm upgrade --install mytube ./k8s/mytube \
  --namespace mytube \
  --set minio.accessKey=YOUR_KEY \
  --set minio.secretKey=YOUR_SECRET \
  --set minio.endpoint=minio.elladali.com
```

Replace `YOUR_KEY`, `YOUR_SECRET`, and `YOUR_ENDPOINT` with your actual MinIO credentials and endpoint.

This method keeps your secrets out of your repository and allows you to manage them securely in your deployment pipeline. 