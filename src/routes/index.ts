import { Router } from 'express';

type TModuleRoute = { path: string; route: Router };

const router = Router();

// Feature routers are appended here as each module lands.
const moduleRoutes: TModuleRoute[] = [];

moduleRoutes.forEach(({ path, route }) => router.use(path, route));

export default router;
