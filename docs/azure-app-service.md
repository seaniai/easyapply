# Azure App Service — EasyApply (Web)

Reference for the **EasyApply** Linux container Web App in resource group **Test1**, paired with ACR [azure-acr.md](./azure-acr.md).

## Summary

| Field | Value |
|--------|--------|
| **Resource name** | `EasyApply` |
| **Kind** | `app,linux,container` |
| **Resource group** | `Test1` |
| **Subscription ID** | `e3f39a42-c191-4356-a034-9062fecebc4d` |
| **Location** | New Zealand North (`newzealandnorth`) |
| **State** | Running |
| **SKU (plan)** | Basic (`ASP-Test1-9a3f`) |
| **Default hostname** | `easyapply-g2epd3dgf0erd3fb.newzealandnorth-01.azurewebsites.net` |
| **HTTPS only** | `true` |
| **Tags** | `project=easyapply`, `owner=Sean` |

## URLs

| Purpose | URL |
|---------|-----|
| **App (browser)** | https://easyapply-g2epd3dgf0erd3fb.newzealandnorth-01.azurewebsites.net/ |
| **Health check** | https://easyapply-g2epd3dgf0erd3fb.newzealandnorth-01.azurewebsites.net/health |
| **SCM / Kudu** | https://easyapply-g2epd3dgf0erd3fb.scm.newzealandnorth-01.azurewebsites.net/ |

## Container image (current vs target)

| | Value |
|---|--------|
| **Current (`linuxFxVersion`)** | `DOCKER\|mcr.microsoft.com/appsvc/staticsite:latest` (placeholder) |
| **Target (after CI/CD)** | `DOCKER\|easyapply.azurecr.io/easyapply-api:<git-sha>` |

## Site config gaps (from snapshot — set before production)

These were **null** or **false** in the API snapshot; configure in Portal:

| Setting | Portal path | Recommended |
|---------|-------------|-------------|
| **Health check path** | **Settings** → **Configuration** → **General settings** | `/health` |
| **Always on** | **Settings** → **Configuration** → **General settings** | **On** |
| **ACR managed identity** | **Deployment** → **Deployment Center** or **Configuration** | **On** after enabling **System assigned** identity |
| **Application settings** | **Settings** → **Environment variables** | See below |

### Required application settings

| Name | Value |
|------|--------|
| `EASYAPPLY_SECRET_ENCRYPTION_KEY` | 32-character secret (Key Vault in production) |
| `EASYAPPLY_DATA_DIR` | `/home/site/wwwroot/data` |
| `WEBSITES_PORT` | `8787` |
| `PORT` | `8787` (recommended; same as container listen port) |

## ACR integration

| Field | Current value |
|--------|----------------|
| **acrUseManagedIdentityCreds** | `false` |
| **acrUserManagedIdentityID** | `null` |

After deploy: enable **EasyApply** → **Settings** → **Identity** → **System assigned** → **On**, grant **AcrPull** on registry `easyapply`, then set **acrUseManagedIdentityCreds** to **true** (or configure via **Deployment Center**).

Registry login server: `easyapply.azurecr.io` — see [azure-acr.md](./azure-acr.md).

## GitHub Actions variables

| Variable | Value |
|----------|--------|
| `AZURE_WEBAPP_NAME` | `EasyApply` |
| `AZURE_RESOURCE_GROUP` | `Test1` |
| `ACR_NAME` | `easyapply` |

Workflow: [`.github/workflows/azure-deploy.yml`](../.github/workflows/azure-deploy.yml)

## Portal resource ID

```text
/subscriptions/e3f39a42-c191-4356-a034-9062fecebc4d/resourceGroups/Test1/providers/Microsoft.Web/sites/EasyApply
```

## App Service plan

```text
/subscriptions/e3f39a42-c191-4356-a034-9062fecebc4d/resourceGroups/Test1/providers/Microsoft.Web/serverfarms/ASP-Test1-9a3f
```

## Raw ARM / API snapshot (2026-05-16 / export 2026-05-17)

<details>
<summary>Full JSON from Azure (apiVersion 2025-05-01)</summary>

```json
{
    "apiVersion": "2025-05-01",
    "id": "/subscriptions/e3f39a42-c191-4356-a034-9062fecebc4d/resourceGroups/Test1/providers/Microsoft.Web/sites/EasyApply",
    "name": "EasyApply",
    "type": "microsoft.web/sites",
    "kind": "app,linux,container",
    "location": "newzealandnorth",
    "tags": {
        "project": "easyapply",
        "owner": "Sean"
    },
    "properties": {
        "name": "EasyApply",
        "state": "Running",
        "hostNames": [
            "easyapply-g2epd3dgf0erd3fb.newzealandnorth-01.azurewebsites.net"
        ],
        "webSpace": "Test1-NewZealandNorthwebspace-Linux",
        "selfLink": "https://waws-prod-nzn-003.api.azurewebsites.windows.net:455/subscriptions/e3f39a42-c191-4356-a034-9062fecebc4d/webspaces/Test1-NewZealandNorthwebspace-Linux/sites/EasyApply",
        "repositorySiteName": "EasyApply",
        "owner": null,
        "usageState": "Normal",
        "enabled": true,
        "adminEnabled": true,
        "siteScopedCertificatesEnabled": false,
        "afdEnabled": false,
        "enabledHostNames": [
            "easyapply-g2epd3dgf0erd3fb.newzealandnorth-01.azurewebsites.net",
            "easyapply-g2epd3dgf0erd3fb.scm.newzealandnorth-01.azurewebsites.net"
        ],
        "siteProperties": {
            "metadata": null,
            "properties": [
                {
                    "name": "LinuxFxVersion",
                    "value": "DOCKER|mcr.microsoft.com/appsvc/staticsite:latest"
                },
                {
                    "name": "WindowsFxVersion",
                    "value": null
                }
            ],
            "appSettings": null
        },
        "availabilityState": "Normal",
        "sslCertificates": null,
        "csrs": [],
        "cers": null,
        "siteMode": null,
        "hostNameSslStates": [
            {
                "name": "easyapply-g2epd3dgf0erd3fb.newzealandnorth-01.azurewebsites.net",
                "sslState": "Disabled",
                "ipBasedSslResult": null,
                "virtualIP": null,
                "virtualIPv6": null,
                "thumbprint": null,
                "certificateResourceId": null,
                "toUpdate": null,
                "toUpdateIpBasedSsl": null,
                "ipBasedSslState": "NotConfigured",
                "hostType": "Standard"
            },
            {
                "name": "easyapply-g2epd3dgf0erd3fb.scm.newzealandnorth-01.azurewebsites.net",
                "sslState": "Disabled",
                "ipBasedSslResult": null,
                "virtualIP": null,
                "virtualIPv6": null,
                "thumbprint": null,
                "certificateResourceId": null,
                "toUpdate": null,
                "toUpdateIpBasedSsl": null,
                "ipBasedSslState": "NotConfigured",
                "hostType": "Repository"
            }
        ],
        "hostNamePrivateStates": [],
        "computeMode": null,
        "serverFarm": null,
        "serverFarmId": "/subscriptions/e3f39a42-c191-4356-a034-9062fecebc4d/resourceGroups/Test1/providers/Microsoft.Web/serverfarms/ASP-Test1-9a3f",
        "reserved": true,
        "isXenon": false,
        "hyperV": false,
        "sandboxType": null,
        "lastModifiedTimeUtc": "2026-05-16T09:31:09.2Z",
        "storageRecoveryDefaultState": "Running",
        "contentAvailabilityState": "Normal",
        "runtimeAvailabilityState": "Normal",
        "dnsConfiguration": {},
        "containerAllocationSubnet": null,
        "useContainerLocalhostBindings": null,
        "outboundVnetRouting": {
            "allTraffic": false,
            "applicationTraffic": false,
            "contentShareTraffic": false,
            "imagePullTraffic": false,
            "backupRestoreTraffic": false,
            "managedIdentityTraffic": false
        },
        "legacyServiceEndpointTrafficEvaluation": null,
        "siteConfig": {
            "numberOfWorkers": 1,
            "defaultDocuments": null,
            "netFrameworkVersion": null,
            "phpVersion": null,
            "pythonVersion": null,
            "nodeVersion": null,
            "powerShellVersion": null,
            "linuxFxVersion": "DOCKER|mcr.microsoft.com/appsvc/staticsite:latest",
            "windowsFxVersion": null,
            "sandboxType": null,
            "windowsConfiguredStacks": null,
            "requestTracingEnabled": null,
            "remoteDebuggingEnabled": null,
            "remoteDebuggingVersion": null,
            "httpLoggingEnabled": null,
            "azureMonitorLogCategories": null,
            "acrUseManagedIdentityCreds": false,
            "acrUserManagedIdentityID": null,
            "logsDirectorySizeLimit": null,
            "detailedErrorLoggingEnabled": null,
            "publishingUsername": null,
            "publishingPassword": null,
            "appSettings": null,
            "metadata": null,
            "connectionStrings": null,
            "machineKey": null,
            "handlerMappings": null,
            "documentRoot": null,
            "scmType": null,
            "use32BitWorkerProcess": null,
            "webSocketsEnabled": null,
            "alwaysOn": false,
            "javaVersion": null,
            "javaContainer": null,
            "javaContainerVersion": null,
            "appCommandLine": null,
            "managedPipelineMode": null,
            "virtualApplications": null,
            "winAuthAdminState": null,
            "winAuthTenantState": null,
            "customAppPoolIdentityAdminState": null,
            "customAppPoolIdentityTenantState": null,
            "runtimeADUser": null,
            "runtimeADUserPassword": null,
            "loadBalancing": null,
            "routingRules": null,
            "experiments": null,
            "limits": null,
            "autoHealEnabled": null,
            "autoHealRules": null,
            "tracingOptions": null,
            "vnetName": null,
            "vnetRouteAllEnabled": null,
            "vnetPrivatePortsCount": null,
            "publicNetworkAccess": null,
            "cors": null,
            "push": null,
            "apiDefinition": null,
            "apiManagementConfig": null,
            "autoSwapSlotName": null,
            "localMySqlEnabled": null,
            "managedServiceIdentityId": null,
            "xManagedServiceIdentityId": null,
            "keyVaultReferenceIdentity": null,
            "ipSecurityRestrictions": null,
            "ipSecurityRestrictionsDefaultAction": null,
            "scmIpSecurityRestrictions": null,
            "scmIpSecurityRestrictionsDefaultAction": null,
            "scmIpSecurityRestrictionsUseMain": null,
            "http20Enabled": false,
            "minTlsVersion": null,
            "minTlsCipherSuite": null,
            "scmMinTlsCipherSuite": null,
            "supportedTlsCipherSuites": null,
            "scmSupportedTlsCipherSuites": null,
            "scmMinTlsVersion": null,
            "ftpsState": null,
            "preWarmedInstanceCount": null,
            "functionAppScaleLimit": 0,
            "elasticWebAppScaleLimit": null,
            "healthCheckPath": null,
            "fileChangeAuditEnabled": null,
            "functionsRuntimeScaleMonitoringEnabled": null,
            "websiteTimeZone": null,
            "minimumElasticInstanceCount": 0,
            "azureStorageAccounts": null,
            "http20ProxyFlag": null,
            "sitePort": null,
            "antivirusScanEnabled": null,
            "storageType": null,
            "sitePrivateLinkHostEnabled": null,
            "clusteringEnabled": false,
            "webJobsEnabled": false
        },
        "functionAppConfig": null,
        "daprConfig": null,
        "aiIntegration": null,
        "deploymentId": "EasyApply",
        "slotName": null,
        "trafficManagerHostNames": null,
        "sku": "Basic",
        "scmSiteAlsoStopped": false,
        "targetSwapSlot": null,
        "hostingEnvironment": null,
        "hostingEnvironmentProfile": null,
        "clientAffinityEnabled": false,
        "clientAffinityProxyEnabled": false,
        "useQueryStringAffinity": false,
        "blockPathTraversal": false,
        "clientCertEnabled": false,
        "clientCertMode": "Required",
        "clientCertExclusionPaths": null,
        "clientCertExclusionEndPoints": null,
        "hostNamesDisabled": false,
        "ipMode": "IPv4",
        "domainVerificationIdentifiers": null,
        "customDomainVerificationId": "123431298260AE6C73D9DE766B51AE14F382DE08436BAF8DE4B604A9BEDD6479",
        "kind": "app,linux,container",
        "managedEnvironmentId": null,
        "workloadProfileName": null,
        "resourceConfig": null,
        "inboundIpAddress": "172.204.161.1",
        "possibleInboundIpAddresses": "172.204.161.1",
        "inboundIpv6Address": "2603:1010:502:1::701",
        "possibleInboundIpv6Addresses": "2603:1010:502:1::701",
        "ftpUsername": "EasyApply\\$EasyApply",
        "ftpsHostName": "ftps://waws-prod-nzn-003.ftp.azurewebsites.windows.net/site/wwwroot",
        "outboundIpAddresses": "172.204.131.13,172.204.131.15,172.204.131.16,172.204.131.17,172.204.131.20,172.204.131.22,172.204.130.230,172.204.130.240,172.204.128.204,172.204.130.241,172.204.130.242,172.204.130.245,172.204.161.1",
        "possibleOutboundIpAddresses": "172.204.131.13,172.204.131.15,172.204.131.16,172.204.131.17,172.204.131.20,172.204.131.22,172.204.130.230,172.204.130.240,172.204.128.204,172.204.130.241,172.204.130.242,172.204.130.245,172.204.130.247,172.204.130.250,172.204.130.251,172.204.130.253,172.204.130.255,172.204.131.1,172.204.131.3,172.204.131.5,172.204.131.7,172.204.131.9,172.204.131.11,172.204.131.12,172.204.131.23,172.204.131.24,172.204.131.25,172.204.131.26,172.204.131.27,172.204.131.28,172.204.161.1",
        "outboundIpv6Addresses": "2603:1010:501:13::114,2603:1010:501:13::115,2603:1010:501:13::116,2603:1010:501:13::117,2603:1010:501:10::2d,2603:1010:501:13::118,2603:1010:501:12::,2603:1010:501:13::10e,2603:1010:501:13::10f,2603:1010:501:10::1f,2603:1010:501:10::29,2603:1010:501:12::9,2603:1010:502:1::701,2603:10e1:100:2::accc:a101",
        "possibleOutboundIpv6Addresses": "2603:1010:501:13::114,2603:1010:501:13::115,2603:1010:501:13::116,2603:1010:501:13::117,2603:1010:501:10::2d,2603:1010:501:13::118,2603:1010:501:12::,2603:1010:501:13::10e,2603:1010:501:13::10f,2603:1010:501:10::1f,2603:1010:501:10::29,2603:1010:501:12::9,2603:1010:501:13::110,2603:1010:501:10::2a,2603:1010:501:13::111,2603:1010:501:10::2b,2603:1010:501:10::2c,2603:1010:501:12::116,2603:1010:501:12::117,2603:1010:501:13::112,2603:1010:501:13::113,2603:1010:501:11::34,2603:1010:501:12::118,2603:1010:501:12::119,2603:1010:501:13::119,2603:1010:501:11::35,2603:1010:501:10::2e,2603:1010:501:13::11a,2603:1010:501:11::36,2603:1010:501:12::11a,2603:1010:502:1::701,2603:10e1:100:2::accc:a101",
        "containerSize": 0,
        "dailyMemoryTimeQuota": 0,
        "suspendedTill": null,
        "siteDisabledReason": 0,
        "functionExecutionUnitsCache": null,
        "maxNumberOfWorkers": null,
        "homeStamp": "waws-prod-nzn-003",
        "cloningInfo": null,
        "hostingEnvironmentId": null,
        "tags": {
            "project": "easyapply",
            "owner": "Sean"
        },
        "resourceGroup": "Test1",
        "defaultHostName": "easyapply-g2epd3dgf0erd3fb.newzealandnorth-01.azurewebsites.net",
        "slotSwapStatus": null,
        "httpsOnly": true,
        "endToEndEncryptionEnabled": false,
        "functionsRuntimeAdminIsolationEnabled": false,
        "redundancyMode": "None",
        "inProgressOperationId": null,
        "geoDistributions": null,
        "privateEndpointConnections": [],
        "publicNetworkAccess": "Enabled",
        "buildVersion": null,
        "targetBuildVersion": null,
        "migrationState": null,
        "eligibleLogCategories": "AppServiceAppLogs,AppServiceConsoleLogs,AppServiceHTTPLogs,AppServicePlatformLogs,ScanLogs,AppServiceAuthenticationLogs,AppServiceAuditLogs,AppServiceIPSecAuditLogs",
        "inFlightFeatures": [],
        "storageAccountRequired": false,
        "virtualNetworkSubnetId": null,
        "keyVaultReferenceIdentity": "SystemAssigned",
        "autoGeneratedDomainNameLabelScope": "TenantReuse",
        "privateLinkIdentifiers": null,
        "sshEnabled": null,
        "maintenanceEnabled": false
    }
}
```

</details>

## See also

- [azure-acr.md](./azure-acr.md) — Container registry `easyapply.azurecr.io`
- [plan.md](./plan.md) — §10 Azure hosting & CI/CD
- [local-web-test.md](./local-web-test.md) — Local Docker / server test
