import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import openapiSpec from './openapi';

const router = Router();

// The raw spec, for importing into Postman or any OpenAPI client.
router.get('/openapi.json', (_req, res) => {
  res.status(200).json(openapiSpec);
});

router.use(
  '/',
  swaggerUi.serve,
  swaggerUi.setup(openapiSpec, {
    customSiteTitle: 'PowerGrid BD API Docs',
    swaggerOptions: { persistAuthorization: true, docExpansion: 'none' },
  })
);

export const DocsRoutes = router;
