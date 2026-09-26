# VapePos Desktop

Aplicación de escritorio para Windows 10 y 11 de 64 bits. Usa el mismo inicio de sesión y los mismos datos que VapePos Web.

## Crear el instalador localmente

```powershell
npm install
npm run desktop:build
```

El instalador queda en `release/VapePos-Setup-<version>-x64.exe`.

## Publicar una actualización

1. Aumentar `version` en `package.json` (por ejemplo, de `1.0.0` a `1.0.1`).
2. Subir los cambios a GitHub.
3. Crear y subir una etiqueta con la misma versión:

```powershell
git tag v1.0.1
git push origin v1.0.1
```

La acción **Publicar VapePos Desktop** genera el instalador y crea la versión en GitHub Releases. Las computadoras con VapePos instalado comprobarán nuevas versiones al iniciar, descargarán la actualización y ofrecerán reiniciar para instalarla.

La compilación actual no está firmada digitalmente, por lo que Windows puede mostrar la advertencia de editor desconocido.
