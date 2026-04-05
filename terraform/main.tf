resource "kubernetes_namespace_v1" "budget" {
  metadata {
    name = "budget"
  }
}

module "bw_actual_password" {
  source      = "git::ssh://git@gitlab.ops.quest:2222/configurations/terraform-modules.git//modules/get_bitwarden_pass?ref=main"
  folder_name = "infra/${kubernetes_namespace_v1.budget.metadata[0].name}"
  item_name   = "ACTUAL_PASSWORD"
}

module "bw_actual_budget_id" {
  source      = "git::ssh://git@gitlab.ops.quest:2222/configurations/terraform-modules.git//modules/get_bitwarden_pass?ref=main"
  folder_name = "infra/${kubernetes_namespace_v1.budget.metadata[0].name}"
  item_name   = "ACTUAL_BUDGET_ID"
}

module "bw_actual_account_id" {
  source      = "git::ssh://git@gitlab.ops.quest:2222/configurations/terraform-modules.git//modules/get_bitwarden_pass?ref=main"
  folder_name = "infra/${kubernetes_namespace_v1.budget.metadata[0].name}"
  item_name   = "ACTUAL_ACCOUNT_ID"
}

module "bw_eb_application_id" {
  source      = "git::ssh://git@gitlab.ops.quest:2222/configurations/terraform-modules.git//modules/get_bitwarden_pass?ref=main"
  folder_name = "infra/${kubernetes_namespace_v1.budget.metadata[0].name}"
  item_name   = "EB_APPLICATION_ID"
}

module "bw_eb_redirect_url" {
  source      = "git::ssh://git@gitlab.ops.quest:2222/configurations/terraform-modules.git//modules/get_bitwarden_pass?ref=main"
  folder_name = "infra/${kubernetes_namespace_v1.budget.metadata[0].name}"
  item_name   = "EB_REDIRECT_URL"
}

module "bw_eb_pem_path" {
  source      = "git::ssh://git@gitlab.ops.quest:2222/configurations/terraform-modules.git//modules/get_bitwarden_pass?ref=main"
  folder_name = "infra/${kubernetes_namespace_v1.budget.metadata[0].name}"
  item_name   = "EB_PEM_PATH"
}

resource "kubernetes_secret_v1" "budget_planning" {
  metadata {
    name      = "eb-importer"
    namespace = kubernetes_namespace_v1.budget.metadata[0].name
  }

  wait_for_service_account_token = false

  data = {
    actual-password   = module.bw_actual_password.password
    actual-budget-id  = module.bw_actual_budget_id.password
    actual-account-id = module.bw_actual_account_id.password
    "private.pem"     = module.bw_eb_pem_path.password
    "config.json" = jsonencode({
      applicationId = module.bw_eb_application_id.password
      redirectUrl   = module.bw_eb_redirect_url.password
    })
  }
}

module "budget_planning_app" {
  source = "git::ssh://git@gitlab.ops.quest:2222/configurations/terraform-modules.git//modules/helm?ref=main"

  release_name     = "budget-planning"
  helm_chart_name  = "${path.module}/.."
  repository_url   = ""
  namespace        = "budget"
  helm_version     = "1.0.0"
  create_namespace = true
  with_values      = true
  values_list = [
    "${path.module}/../values/values.yaml",
  ]

}

module "remote_state" {
  source      = "git::ssh://git@gitlab.ops.quest:2222/configurations/terraform-modules.git//modules/remote-state?ref=main"
  service     = "budget-planning-secrets"
  backend     = "kubernetes"
  config_path = var.config_path
}
