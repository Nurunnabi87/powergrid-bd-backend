import { Router } from 'express';
import { AuthRoutes } from '../modules/auth/auth.routes';
import { ZoneRoutes } from '../modules/zone/zone.routes';

type TModuleRoute = { path: string; route: Router };

const router = Router();

// Feature routers are appended here as each module lands.
const moduleRoutes: TModuleRoute[] = [
  { path: '/auth', route: AuthRoutes },
  { path: '/zones', route: ZoneRoutes },
];

moduleRoutes.forEach(({ path, route }) => router.use(path, route));

export default router;
