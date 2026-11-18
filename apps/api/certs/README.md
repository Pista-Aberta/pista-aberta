# Certificados SAML de demo

**Só para desenvolvemento e demo.** Non son Cl@ve real nin certificados de ningunha administración.

Os ficheiros `*-key.pem` e `*-cert.pem` **non van no git**. Xéranse automaticamente se faltan:

```bash
cd apps/api/certs
openssl req -x509 -newkey rsa:2048 -nodes -keyout idp-key.pem -out idp-cert.pem -days 825 \
  -subj "/CN=Pista Aberta IdP Mock/O=Demo/C=ES"
openssl req -x509 -newkey rsa:2048 -nodes -keyout sp-key.pem -out sp-cert.pem -days 825 \
  -subj "/CN=Pista Aberta SP Demo/O=Demo/C=ES"
```

`install.sh` e o arranque en desenvolvemento poden crear estes PEM se non existen.
Na demo pública, móntanse desde o servidor (non se regeneran en cada deploy).

| Ficheiro | Uso |
|----------|-----|
| `idp-key.pem` / `idp-cert.pem` | IdP mock (asina AuthnResponse / Assertion) |
| `sp-key.pem` / `sp-cert.pem` | SP Pista Aberta (metadatos; AuthnRequest asinado) |
