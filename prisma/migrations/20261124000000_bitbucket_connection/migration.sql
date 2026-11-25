-- CreateTable
CREATE TABLE "BitbucketConnection" (
    "departmentId" UUID NOT NULL,
    "username" TEXT,
    "workspace" TEXT,
    "tokenCipher" TEXT NOT NULL,
    "connectedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "BitbucketConnection_pkey" PRIMARY KEY ("departmentId")
);

-- AddForeignKey
ALTER TABLE "BitbucketConnection" ADD CONSTRAINT "BitbucketConnection_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
