# PYQ Lab

A no-signup practice workspace for previous-year question papers. React and Vite power the frontend. Original question-paper PDFs live in the browser. Express uses temporary upload files for extraction and stores practice data and attempts in PostgreSQL.

## Run locally

Use Node.js 22.13 or later. In this directory, run `npm ci`, copy `.env.example` to `.env`, and set `DATABASE_URL` to your PostgreSQL connection string. You can also supply the connection string through the process environment. Run `npm run dev` and open [PYQ Lab](http://127.0.0.1:5173).

For a production build, run `npm run build` followed by `npm start`. The server uses loopback by default. Set `PORT` and `HOST` for the deployment environment. The app creates its own `pyq_lab_*` tables on first use.

## Practice workflow

1. Import a question-paper PDF up to 20 MB and 100 pages. A separate answer key can be a PDF (up to 20 pages) or JPG (up to 16 megapixels), up to 20 MB. The key can contain numbered choices such as `1. B` and `2. A, C`, ranges such as `12–14: B | (A,D) | C`, or an unnumbered sequence with a specified first question number.
   After the file uploads, the app checks extraction progress separately. Keep the import dialog open to review the questions when they are ready.
2. Check the extracted text, choices, diagrams, and answer-key matches against the source. The uploaded key takes precedence for questions it can match. Use **View answer key** to compare the selections, or tick correct choices manually. Use **Add diagram** to crop missing figures. Complex layouts and scans may require manual corrections.
3. Save the set under a subject, then choose all questions, MCQs only, or MSQs only. Use the navigator to jump between questions and mark them Important, Needs review, or Needs topic revision.
4. Submit to see your selected letters and the correct choices, where mapped. An MSQ earns credit when the selection exactly matches the key. Use **Match answer key** in Paper library or ungraded results to upload a key or paste answers. Saving the confirmed matches updates existing scores.
5. Open **Improvement** to revisit questions marked Important or Needs topic revision. It groups paused and submitted questions by paper and provides paper and marker filters.

Use the delete action in **Paper library** to remove an imported paper, its paused drafts, its completed results, and its marked questions from Improvement.

Original PDFs and their diagrams are available in the browser profile and site where you imported them. Keep a downloaded backup before clearing site data. To remove an older PDF from Neon, open its source PDF in **Paper library**, select **Move PDF to this browser**, and confirm. The app verifies the saved browser copy before removing the database copy.

### Hindi papers

Automatic mode reads selectable Hindi and English text and tries OCR on scanned pages. Choose **Hindi (हिन्दी)** if an older Hindi PDF has an unreadable text layer. The importer recognizes Devanagari question numbers such as १२ and option labels such as क, ख, ग, घ. **View extracted text** opens a copyable preview and a UTF-8 text download, even if the paper has no multiple-choice questions. For new saved imports, the text is also available from the source PDF dialog in Paper library. Review OCR output against the original on low-quality scans.

In-progress attempts save in the current browser. The browser's randomly generated workspace key links it to saved papers and results. Clearing site data or changing browsers creates a new workspace. Three built-in sample sets are available.

PDF extraction uses [pdf-parse](https://github.com/mehmet-kozan/pdf-parse) and [Tesseract.js](https://github.com/naptha/tesseract.js).

## Deploy from GitHub

The repository root contains the app. You can serve everything from Render, or host the React frontend on Vercel and keep the Express API on Render. Use the production site URL consistently because this no-signup app stores its workspace key per browser and site origin.

### 1. Deploy the Express API on Render

1. Open the Render dashboard and choose **New → Web Service**. Connect the `Udaybhatnagar/PyqLab` GitHub repository and choose the `main` branch. Leave **Root Directory** blank and select **Node** as the runtime.
2. Set **Build Command** to `npm ci --include=dev && npm run build` and **Start Command** to `npm start`. Set the **Health Check Path** to `/health`.
3. In Environment, add `DATABASE_URL` with your Neon PostgreSQL connection string and `HOST=0.0.0.0`. Use Node 24. Render supplies `PORT` automatically.
4. Deploy and open the assigned `https://<service>.onrender.com` URL. The same service serves the built frontend, so this URL already runs the full app.

[Render Express deployment guide](https://render.com/docs/deploy-node-express-app) · [Render environment variables](https://render.com/docs/configure-environment-variables)

### 2. Optional Vercel frontend

The production app at [pyq-lab-beta.vercel.app](https://pyq-lab-beta.vercel.app/) already defaults to the API at [pyqlab.onrender.com](https://pyqlab.onrender.com/). The environment settings below apply to additional deployments or a different API origin.

1. In Vercel, choose **Add New → Project** and import the same GitHub repository. Select **Vite**, keep the root at the repository root, use Node 24, and set the build command to `npm run build` and output directory to `dist`.
2. Add the production environment variable `VITE_API_ORIGIN` with the Render origin, for example `https://<service>.onrender.com`. Deploy, then copy the stable production Vercel URL.
3. Back on Render, set `FRONTEND_ORIGIN` to that Vercel origin, for example `https://<project>.vercel.app`, and redeploy the API. Use a comma-separated list if you have more than one approved frontend origin. Use origins with no `/api` suffix in either setting.
4. Open the Vercel URL, import a small test PDF, complete a practice attempt, and check My progress.

Set the database credential in **Render's** `DATABASE_URL` and use `sslmode=verify-full` for Neon. The Vercel `VITE_API_ORIGIN` is a public URL. PDF uploads and OCR go directly to Render.

[Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite) · [Vercel project settings](https://vercel.com/docs/project-configuration/project-settings)
