import { Router } from 'express';
import { AuthRoutes } from '../modules/auth/auth.routes';
import { SubstationRoutes } from '../modules/substation/substation.routes';
import { FeederRoutes } from '../modules/feeder/feeder.routes';
import { AreaRoutes } from '../modules/area/area.routes';
import { ZoneRoutes } from '../modules/zone/zone.routes';

type TModuleRoute = { path: string; route: Router };

const router = Router();

// Feature routers are appended here as each module lands.
const moduleRoutes: TModuleRoute[] = [
  { path: '/auth', route: AuthRoutes },
  { path: '/zones', route: ZoneRoutes },
  { path: '/substations', route: SubstationRoutes },
  { path: '/feeders', route: FeederRoutes },
  { path: '/areas', route: AreaRoutes },
];

moduleRoutes.forEach(({ path, route }) => router.use(path, route));

export default router;
