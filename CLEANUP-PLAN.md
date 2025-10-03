# 🧹 Plano de Limpeza de Recursos AWS

Data: 02 de Outubro de 2025

## 📊 **Recursos Atualmente em Uso**

### ✅ **MANTER (Em Produção)**
1. **Bucket S3**: `talksy-videos-dev-0c18ea10` - Gravações ativas
2. **Fila SQS**: `talksy-meetingbot-jobs.fifo` - Jobs principais
3. **Fila SQS**: `talksy-recording-completed.fifo` - Completion messages
4. **Fila SQS**: `talksy-meetingbot-dlq.fifo` - Dead letter queue
5. **Fila SQS**: `talksy-recording-completed-dlq.fifo` - Dead letter queue
6. **Banco RDS**: `meetingbot-dev` - Banco de dados principal
7. **ECS Cluster**: `meetingbot-dev` - Cluster principal
8. **Load Balancer**: `meetingbot-dev-alb` - Load balancer ativo
9. **ECR Repositories**: 
   - `meetingbot-service`
   - `meetingbot-bot`
   - `meetingbot-server`

---

## ❌ **DELETAR (Não estão em uso)**

### **Buckets S3** - 3 buckets antigos
1. ❌ `meetingbot-dev-44989554-bot-data` (vazio/antigo)
2. ❌ `meetingbot-dev-52866384-bot-data` (vazio/antigo)
3. ❌ `talksy-meetingbot` (antigo, substituído por talksy-videos-dev-0c18ea10)

**Ação**: Deletar após verificar se estão vazios

### **Filas SQS** - 2 filas de teste
1. ❌ `talksy-meetingbot-jobs-test-standard` (fila de teste)
2. ❌ `talksy-meetingbot-jobs-test.fifo` (fila de teste)
3. ❌ `talksy-meetingbot-jobs-dlq.fifo` (DLQ duplicada/antiga)

**Ação**: Deletar filas de teste

### **Banco RDS** - 1 banco de produção não usado
1. ⚠️ `meetingbot-prod` - Banco de produção (pausar ou deletar se não for usar)

**Ação**: 
- Se for usar: MANTER
- Se não for usar: Criar snapshot e deletar

### **ECS Services** - 2 serviços antigos
1. ❌ `meetingbot-dev-meetingbot-service` (substituído por `meetingbot-dev-service-processor`)
2. ❌ `meetingbot-dev-server` (substituído por `meetingbot-dev-server-new`)

**Ação**: Deletar serviços com DesiredCount=0

### **Load Balancer**
1. ⚠️ `meetingbot-prod-alb` - Load balancer de produção

**Ação**: Verificar se está em uso, se não, deletar

### **Target Groups** - 1 antigo
1. ❌ `meetingbot-dev-server-instance` (tipo instance, substituído por meetingbot-dev-server-ip2)

**Ação**: Deletar

### **ECS Tasks** - 7 tasks paradas
**Ação**: Já foram paradas automaticamente, nenhuma ação necessária

---

## 💰 **Estimativa de Economia**

### Custos aproximados mensais a eliminar:
- **3 Buckets S3 vazios**: ~$0.50/mês
- **3 Filas SQS de teste**: ~$0.10/mês
- **1 Banco RDS prod (db.t4g.micro)**: ~$15-20/mês
- **1 Load Balancer prod**: ~$16/mês
- **Total potencial**: **~$32-37/mês**

---

## 🎯 **Comandos de Limpeza**

Veja `scripts/cleanup-resources.sh` para executar automaticamente.

