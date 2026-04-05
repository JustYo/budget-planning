terraform {
  required_version = ">= 1.0"
  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "3.0.1"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 3.0"
    }
  }
  backend "kubernetes" {
    secret_suffix    = "state-budget-planning" # checkov:skip=CKV_SECRET_6:Kubernetes secret reference, not hardcoded credential
    load_config_file = true
    config_path      = "~/.kube/config-microk8s"
    namespace        = "budget"
  }
}
