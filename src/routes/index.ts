import { Router } from 'express';
import { AuthRoutes } from '../modules/auth/auth.routes';
import { SubstationRoutes } from '../modules/substation/substation.routes';
import { FeederRoutes } from '../modules/feeder/feeder.routes';
import { AreaRoutes } from '../modules/area/area.routes';
import { UserRoutes } from '../modules/user/user.routes';
import { ConnectionRoutes } from '../modules/connection/connection.routes';
import { NotificationRoutes } from '../modules/notification/notification.routes';
import { ScheduleRoutes } from '../modules/schedule/schedule.routes';
import { ZoneRoutes } from '../modules/zone/zone.routes';

type TModuleRoute = { path: string; route: Router };

const router = Router();

// Feature routers are appended here as each module lands.
const moduleRoutes: TModuleRoute[] = [
  { path: '/auth', route: AuthRoutes },
  { path: '/users', route: UserRoutes },
  { path: '/zones', route: ZoneRoutes },
  { path: '/substations', route: SubstationRoutes },
  { path: '/feeders', route: FeederRoutes },
  { path: '/areas', route: AreaRoutes },
  { path: '/connections', route: ConnectionRoutes },
  { path: '/schedules', route: ScheduleRoutes },
  { path: '/notifications', route: NotificationRoutes },
];

moduleRoutes.forEach(({ path, route }) => router.use(path, route));

export default router;
