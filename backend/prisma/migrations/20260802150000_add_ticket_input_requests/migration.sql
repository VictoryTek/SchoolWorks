-- CreateTable
CREATE TABLE "ticket_input_requests" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedOfId" TEXT NOT NULL,
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_input_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_input_requests_ticketId_idx" ON "ticket_input_requests"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_input_requests_requestedOfId_dismissedAt_idx" ON "ticket_input_requests"("requestedOfId", "dismissedAt");

-- CreateIndex
CREATE INDEX "ticket_input_requests_requestedById_idx" ON "ticket_input_requests"("requestedById");

-- AddForeignKey
ALTER TABLE "ticket_input_requests" ADD CONSTRAINT "ticket_input_requests_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_input_requests" ADD CONSTRAINT "ticket_input_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_input_requests" ADD CONSTRAINT "ticket_input_requests_requestedOfId_fkey" FOREIGN KEY ("requestedOfId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
