# 📚 Índice de Documentação - MeetingBot

Documentação completa do sistema MeetingBot para gravação de reuniões.

---

## 🚀 **Deployment e Infraestrutura**

### **DEPLOYMENT-SUMMARY.md**
Resumo completo do deployment atual.
- ✅ Componentes em execução
- ✅ AWS Resources (ECS, S3, RDS, SQS)
- ✅ Arquitetura do fluxo
- ✅ Correções implementadas
- ✅ Como testar

---

## 🔐 **Segurança e Secrets**

### **scripts/SECRETS-README.md**
Guia de uso do AWS Secrets Manager.
- 🔐 Secrets armazenados
- 🛠️ Scripts disponíveis
- 📝 Como usar e atualizar
- 🔄 Rotação de secrets

### **Secrets Criados:**
- `meetingbot-dev/credentials` - Credenciais sensíveis
- `meetingbot-dev/config` - Configurações do ambiente

---

## 📁 **Armazenamento S3**

### **S3-STORAGE-GUIDE.md** ⭐
Guia completo da estrutura de armazenamento.
- 📂 Estrutura de diretórios
- 🔑 Formato do path
- 🔐 Segurança e criptografia
- 📨 Completion messages
- 🔧 Como backend deve consumir
- 🔍 Queries úteis (AWS CLI)
- 🛡️ Políticas de acesso

### **S3-STRUCTURE-EXAMPLE.md**
Exemplo real com gravação atual.
- 🎯 Path completo
- 📊 Metadados
- 🔍 Como buscar
- 🔐 URLs assinadas
- 🎨 Frontend exemplo

### **BACKEND-INTEGRATION-EXAMPLES.md** ⭐
Exemplos práticos de código.
- 📤 Enviar bot para reunião (Node.js/Python)
- 📨 Processar completion messages
- 📝 Listar gravações por usuário
- 🔐 Gerenciamento de permissões
- 🌐 API REST completa
- 📊 Dashboard queries
- ✅ Checklist de integração

---

## 🧹 **Limpeza e Otimização**

### **CLEANUP-PLAN.md**
Plano inicial de limpeza de recursos.
- ❌ Recursos para deletar
- ✅ Recursos para manter
- 💰 Estimativa de economia
- 🎯 Comandos de limpeza

### **CLEANUP-COMPLETED.md**
Resumo da limpeza realizada.
- ✅ Recursos deletados/pausados
- 💰 Economia realizada (~$33/mês)
- 📊 Status final
- 🔄 Como restaurar se necessário

### **scripts/cleanup-resources.sh**
Script automatizado de limpeza.
- 🧹 Deletar buckets vazios
- 🧹 Deletar filas de teste
- 🧹 Deletar serviços antigos
- 🧹 Criar snapshots de bancos

---

## 📖 **Guias e READMEs**

### **README.md**
README principal do projeto (original do MeetingBot).

### **README-TESTE-LOCAL.md**
Guia para testes locais.

### **src/meetingbot-service/bots/README.md**
Estrutura e responsabilidades dos bots.

---

## 🎯 **Por Onde Começar?**

### **Para Desenvolvedores Backend:**
1. 📖 Leia `S3-STORAGE-GUIDE.md`
2. 💻 Veja exemplos em `BACKEND-INTEGRATION-EXAMPLES.md`
3. 🔐 Configure secrets com `scripts/SECRETS-README.md`

### **Para DevOps/Infra:**
1. 📖 Leia `DEPLOYMENT-SUMMARY.md`
2. 🧹 Execute `CLEANUP-COMPLETED.md` para entender otimizações
3. 🔐 Acesse secrets com `scripts/get-secrets.sh`

### **Para Product Managers:**
1. 📖 Veja fluxo completo em `DEPLOYMENT-SUMMARY.md`
2. 📊 Entenda estrutura em `S3-STRUCTURE-EXAMPLE.md`
3. 💰 Veja custos em `CLEANUP-COMPLETED.md`

---

## 🔗 **Links Rápidos**

### **URLs do Sistema:**
- 🌐 Servidor Web: https://meetingbot.talksy.io/
- 📦 Bucket S3: `talksy-videos-dev-0c18ea10`
- 📬 Jobs Queue: `talksy-meetingbot-jobs.fifo`
- 📬 Completion Queue: `talksy-recording-completed.fifo`

### **AWS Resources:**
- 🗄️ Banco RDS: `meetingbot-dev.cot0hv85yicn.us-east-1.rds.amazonaws.com`
- 🎛️ ECS Cluster: `meetingbot-dev`
- 🔐 Secrets: `meetingbot-dev/credentials`, `meetingbot-dev/config`

---

## 📊 **Estrutura Visual**

```
┌─────────────────────────────────────────────────────────────┐
│                    MEETINGBOT SYSTEM                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────┐  ┌──────────────┐  ┌─────────────────────┐
│   Backend API   │→→│  SQS Jobs    │→→│ MeetingBot Service  │
│  (Talksy)       │  │    Queue     │  │    (ECS Task)       │
└─────────────────┘  └──────────────┘  └─────────────────────┘
                                                   │
                                                   ▼
                                        ┌─────────────────────┐
                                        │   Bot (ECS Task)    │
                                        │  - Entra reunião    │
                                        │  - Grava vídeo      │
                                        │  - Detecta speakers │
                                        └─────────────────────┘
                                                   │
                    ┌──────────────────────────────┴───────────┐
                    ▼                                          ▼
         ┌──────────────────────┐                  ┌──────────────────┐
         │   S3 Bucket          │                  │  SQS Completion  │
         │   (Encrypted KMS)    │                  │      Queue       │
         │                      │                  └──────────────────┘
         │ users/                │                           │
         │  └─ email/            │                           ▼
         │     └─ recordings/    │              ┌──────────────────────┐
         │        └─ uuid.mp4    │              │   Backend Worker     │
         └──────────────────────┘              │  - Salva DB          │
                    │                           │  - Gera URL          │
                    │                           │  - Notifica user     │
                    │                           └──────────────────────┘
                    ▼                                        │
         ┌──────────────────────┐                           ▼
         │   Frontend           │                ┌──────────────────────┐
         │  - Lista gravações   │←←←←←←←←←←←←←←│   PostgreSQL DB      │
         │  - Video player      │                │  - Metadados         │
         │  - Download          │                │  - Permissões        │
         └──────────────────────┘                └──────────────────────┘
```

---

## 🎓 **Glossário**

- **Job**: Requisição para gravar uma reunião
- **Bot**: Instância do gravador (ECS task)
- **Completion**: Notificação de gravação finalizada
- **Presigned URL**: URL temporária e segura para acesso ao S3
- **Sanitização**: Processo de limpar caracteres especiais do email
- **UUID**: Identificador único universal para cada gravação
- **KMS**: Key Management Service (criptografia AWS)

---

## 📞 **Suporte**

### **Para acessar secrets:**
```bash
./scripts/get-secrets.sh
```

### **Para carregar ambiente:**
```bash
source scripts/load-secrets-to-env.sh
```

### **Para limpar recursos:**
```bash
./scripts/cleanup-resources.sh
```

---

**✨ Sistema completamente documentado e pronto para uso!**

