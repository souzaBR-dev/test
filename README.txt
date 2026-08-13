MADAME GLAMOUR FIOS — PIX COM CONFIRMAÇÃO AUTOMÁTICA

Esta versão adiciona um backend Node.js + Mercado Pago.
Fluxo:
1. Cliente finaliza no site.
2. Servidor cria um pagamento PIX dinâmico.
3. O checkout mostra QR Code e Pix Copia e Cola retornados pelo gateway.
4. Mercado Pago envia um webhook quando o pagamento muda de status.
5. O servidor consulta o pagamento no Mercado Pago e marca o pedido como APPROVED.
6. A tela do cliente consulta o pedido e muda para "PIX confirmado".

REQUISITOS:
- Node.js 18+
- Conta de vendedor no Mercado Pago
- Access Token de produção ou teste
- Hospedagem com HTTPS e URL pública para webhook

CONFIGURAÇÃO:
1. Copie .env.example para .env.
2. Preencha MP_ACCESS_TOKEN.
3. Preencha MP_NOTIFICATION_URL com:
   https://SEU-DOMINIO.com/api/webhooks/mercadopago
4. npm install
5. npm start

IMPORTANTE:
- NUNCA coloque MP_ACCESS_TOKEN no HTML/JavaScript do navegador.
- Para produção, troque o arquivo data/orders.json por um banco de dados.
- O gateway confirma o pagamento; a chave Pix da loja continua sendo uma chave de recebimento, mas o pagamento desta integração é processado pela conta do gateway.
- Se a loja quiser receber diretamente em outra conta bancária usando a chave Pix +55 24 99875-5597, será necessário usar a API Pix do banco/PSP que mantém essa conta, caso ofereça essa integração.

DOCUMENTAÇÃO:
Mercado Pago Pix: https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix
Mercado Pago Webhooks: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/payment-notifications


PAINEL ADMINISTRATIVO
- Acesse /admin
- Defina ADMIN_TOKEN no .env
- O painel mostra total, pagos, não pagos, cancelados e faturamento pago.
- Cada pedido tem "Verificar pagamento", que consulta o gateway no servidor.
- O webhook continua atualizando o status automaticamente.

SEGURANÇA
- O token de administração fica somente no servidor.
- Em produção, use HTTPS.
- Troque o token por um segredo forte e não o publique.
