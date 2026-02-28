# Editor PDF (React + TypeScript)

Este proyecto es un editor PDF en navegador que permite:

- Abrir un archivo PDF.
- Dibujar encima del documento.
- Agregar texto nuevo.
- Editar visualmente texto existente del PDF.
- Exportar/descargar un PDF final con cambios aplicados.

## 1) Tecnologías usadas

- React + TypeScript + Vite
- `pdfjs-dist`: leer y renderizar PDF en el navegador
- `pdf-lib`: generar el PDF exportado

Dependencias principales en `package.json`:

- `pdfjs-dist`
- `pdf-lib`

## 2) Cómo ejecutar el proyecto

1. Instalar dependencias:

```bash
npm install
```

2. Levantar en modo desarrollo:

```bash
npm run dev
```

3. (Opcional) Build de producción:

```bash
npm run build
```

## 3) Cómo usar la app

1. Clic en **Abrir PDF** y selecciona un archivo.
2. Elige herramienta:
   - **Dibujar**: trazo libre con mouse.
   - **Texto**: clic para insertar texto nuevo.
   - **Editar texto PDF**: clic en zona de texto detectada para reemplazarlo.
3. Usa:
   - **Deshacer**: elimina la última anotación.
   - **Limpiar**: elimina todas las anotaciones.
4. Clic en **Exportar PDF** para descargar el resultado.

## 4) ¿Cómo está implementado?

### 4.1 Carga y render del PDF

En `src/App.tsx`:

- Se configura el worker de `pdfjs-dist` con `GlobalWorkerOptions.workerSrc`.
- Al abrir un archivo, se lee como `Uint8Array` y se carga con `getDocument`.
- Cada página se renderiza en un `canvas` y se guarda como imagen (`imageData`) para mostrarla en pantalla.

### 4.2 Dibujo y texto sobre el PDF

- Encima de cada imagen se dibuja una capa `svg`.
- En esa capa se guardan anotaciones en estado (`annotations`) con tipos:
  - `draw`
  - `text`
  - `replace-text`

### 4.3 Edición de texto existente (modo visual)

- Se extraen bloques de texto del PDF con `page.getTextContent()`.
- Cada bloque se convierte en un área clickeable (`hitbox`) para editar.
- Al editar un bloque repetidamente, se usa **la última versión** (no el texto original) para precargar el prompt.
- En render se muestra solo la última edición por bloque (`latestReplaceByBlock`).

> Nota importante: esta edición es **visual** (overlay), no modifica la estructura interna original del texto dentro del PDF fuente.

### 4.4 Exportación

Botón **Exportar PDF**:

1. Crea un PDF nuevo con `PDFDocument.create()`.
2. Para cada página:
   - Dibuja la imagen base del PDF en un `canvas`.
   - Dibuja encima todas las anotaciones visibles.
3. Convierte el canvas a PNG.
4. Inserta esa imagen en una página del nuevo PDF.
5. Descarga el archivo como `nombre-editado.pdf`.

## 5) Estructura de archivos clave

- `src/App.tsx`: lógica completa del editor (carga, edición, exportación).
- `src/App.css`: estilos de interfaz y capas de interacción.
- `src/index.css`: estilos globales base.

## 6) Limitaciones actuales

- La edición de texto del PDF es visual, no de contenido interno semántico.
- La exportación es “aplanada” por página (se guarda como imagen dentro de PDF).
- PDFs muy grandes pueden tardar más en cargar/exportar.

## 7) Siguientes mejoras sugeridas

- Mover texto editado con drag & drop.
- Selector de calidad de exportación.
- Panel de capas/historial para edición más avanzada.
