-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'TECHNICIAN', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BANNED');

-- CreateEnum
CREATE TYPE "SubstationStatus" AS ENUM ('OPERATIONAL', 'MAINTENANCE', 'OFFLINE');

-- CreateEnum
CREATE TYPE "PriorityTier" AS ENUM ('CRITICAL', 'HIGH', 'NORMAL', 'LOW');

-- CreateEnum
CREATE TYPE "ConnectionType" AS ENUM ('RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutageType" AS ENUM ('SCHEDULED', 'UNEXPECTED');

-- CreateEnum
CREATE TYPE "OutageStatus" AS ENUM ('REPORTED', 'ACKNOWLEDGED', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutageSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'ACCEPTED', 'COMPLETED', 'REASSIGNED');

-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'OVERDUE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'PENDING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('BKASH');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SCHEDULE_PUBLISHED', 'OUTAGE_REPORTED', 'OUTAGE_ASSIGNED', 'OUTAGE_RESOLVED', 'POWER_RESTORED', 'BILL_GENERATED', 'PAYMENT_SUCCESS', 'PAYMENT_FAILED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "googleId" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "avatarUrl" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "technician_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "specialization" TEXT NOT NULL,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "activeJobCount" INTEGER NOT NULL DEFAULT 0,
    "maxConcurrentJobs" INTEGER NOT NULL DEFAULT 3,
    "zoneId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "technician_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "distribution_zones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distribution_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "substations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "capacityMva" DOUBLE PRECISION NOT NULL,
    "status" "SubstationStatus" NOT NULL DEFAULT 'OPERATIONAL',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "substations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeders" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "substationId" TEXT NOT NULL,
    "voltageLevel" TEXT NOT NULL,
    "loadKw" DOUBLE PRECISION NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feeders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "areas" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "feederId" TEXT NOT NULL,
    "population" INTEGER NOT NULL DEFAULT 0,
    "priorityTier" "PriorityTier" NOT NULL DEFAULT 'NORMAL',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "areas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connections" (
    "id" TEXT NOT NULL,
    "meterNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "connectionType" "ConnectionType" NOT NULL DEFAULT 'RESIDENTIAL',
    "tariffRate" DOUBLE PRECISION NOT NULL DEFAULT 7.5,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_shedding_schedules" (
    "id" TEXT NOT NULL,
    "feederId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'PLANNED',
    "isAutoGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "load_shedding_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outages" (
    "id" TEXT NOT NULL,
    "type" "OutageType" NOT NULL DEFAULT 'UNEXPECTED',
    "areaId" TEXT NOT NULL,
    "feederId" TEXT,
    "reportedById" TEXT,
    "status" "OutageStatus" NOT NULL DEFAULT 'REPORTED',
    "severity" "OutageSeverity" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "photoUrl" TEXT,
    "affectedCustomers" INTEGER NOT NULL DEFAULT 0,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "downtimeMinutes" INTEGER,
    "resolutionNote" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outage_assignments" (
    "id" TEXT NOT NULL,
    "outageId" TEXT NOT NULL,
    "technicianId" TEXT NOT NULL,
    "assignedById" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "notes" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outage_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "unitsConsumed" DOUBLE PRECISION NOT NULL,
    "tariffRate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "lateFee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'UNPAID',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "provider" "PaymentProvider" NOT NULL DEFAULT 'BKASH',
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIATED',
    "paymentID" TEXT,
    "trxID" TEXT,
    "merchantInvoiceNumber" TEXT NOT NULL,
    "payerReference" TEXT,
    "gatewayResponse" JSONB,
    "failureReason" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "outageId" TEXT,
    "scheduleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");

-- CreateIndex
CREATE INDEX "users_isDeleted_idx" ON "users"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "technician_profiles_userId_key" ON "technician_profiles"("userId");

-- CreateIndex
CREATE INDEX "technician_profiles_zoneId_isAvailable_idx" ON "technician_profiles"("zoneId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "distribution_zones_code_key" ON "distribution_zones"("code");

-- CreateIndex
CREATE INDEX "distribution_zones_isDeleted_idx" ON "distribution_zones"("isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "substations_code_key" ON "substations"("code");

-- CreateIndex
CREATE INDEX "substations_zoneId_isDeleted_idx" ON "substations"("zoneId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "feeders_code_key" ON "feeders"("code");

-- CreateIndex
CREATE INDEX "feeders_substationId_isDeleted_idx" ON "feeders"("substationId", "isDeleted");

-- CreateIndex
CREATE UNIQUE INDEX "areas_code_key" ON "areas"("code");

-- CreateIndex
CREATE INDEX "areas_feederId_isDeleted_idx" ON "areas"("feederId", "isDeleted");

-- CreateIndex
CREATE INDEX "areas_priorityTier_idx" ON "areas"("priorityTier");

-- CreateIndex
CREATE UNIQUE INDEX "connections_meterNo_key" ON "connections"("meterNo");

-- CreateIndex
CREATE INDEX "connections_customerId_isDeleted_idx" ON "connections"("customerId", "isDeleted");

-- CreateIndex
CREATE INDEX "connections_areaId_status_idx" ON "connections"("areaId", "status");

-- CreateIndex
CREATE INDEX "load_shedding_schedules_feederId_date_status_idx" ON "load_shedding_schedules"("feederId", "date", "status");

-- CreateIndex
CREATE INDEX "load_shedding_schedules_date_status_idx" ON "load_shedding_schedules"("date", "status");

-- CreateIndex
CREATE INDEX "outages_status_areaId_idx" ON "outages"("status", "areaId");

-- CreateIndex
CREATE INDEX "outages_type_status_idx" ON "outages"("type", "status");

-- CreateIndex
CREATE INDEX "outages_reportedById_idx" ON "outages"("reportedById");

-- CreateIndex
CREATE INDEX "outages_createdAt_idx" ON "outages"("createdAt");

-- CreateIndex
CREATE INDEX "outage_assignments_technicianId_status_idx" ON "outage_assignments"("technicianId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "outage_assignments_outageId_technicianId_key" ON "outage_assignments"("outageId", "technicianId");

-- CreateIndex
CREATE INDEX "bills_customerId_status_idx" ON "bills"("customerId", "status");

-- CreateIndex
CREATE INDEX "bills_status_dueDate_idx" ON "bills"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "bills_connectionId_billingPeriod_key" ON "bills"("connectionId", "billingPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "payments_paymentID_key" ON "payments"("paymentID");

-- CreateIndex
CREATE UNIQUE INDEX "payments_trxID_key" ON "payments"("trxID");

-- CreateIndex
CREATE UNIQUE INDEX "payments_merchantInvoiceNumber_key" ON "payments"("merchantInvoiceNumber");

-- CreateIndex
CREATE INDEX "payments_customerId_status_idx" ON "payments"("customerId", "status");

-- CreateIndex
CREATE INDEX "payments_billId_idx" ON "payments"("billId");

-- CreateIndex
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_profiles" ADD CONSTRAINT "technician_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "technician_profiles" ADD CONSTRAINT "technician_profiles_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "distribution_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "substations" ADD CONSTRAINT "substations_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "distribution_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feeders" ADD CONSTRAINT "feeders_substationId_fkey" FOREIGN KEY ("substationId") REFERENCES "substations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "areas" ADD CONSTRAINT "areas_feederId_fkey" FOREIGN KEY ("feederId") REFERENCES "feeders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "connections" ADD CONSTRAINT "connections_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_shedding_schedules" ADD CONSTRAINT "load_shedding_schedules_feederId_fkey" FOREIGN KEY ("feederId") REFERENCES "feeders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_shedding_schedules" ADD CONSTRAINT "load_shedding_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outages" ADD CONSTRAINT "outages_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outages" ADD CONSTRAINT "outages_feederId_fkey" FOREIGN KEY ("feederId") REFERENCES "feeders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outages" ADD CONSTRAINT "outages_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outage_assignments" ADD CONSTRAINT "outage_assignments_outageId_fkey" FOREIGN KEY ("outageId") REFERENCES "outages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outage_assignments" ADD CONSTRAINT "outage_assignments_technicianId_fkey" FOREIGN KEY ("technicianId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outage_assignments" ADD CONSTRAINT "outage_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_outageId_fkey" FOREIGN KEY ("outageId") REFERENCES "outages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "load_shedding_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
