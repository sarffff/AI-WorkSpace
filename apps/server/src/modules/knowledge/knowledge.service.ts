import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/prisma/prisma.service'

@Injectable()
export class KnowledgeService {
  constructor(private prisma: PrismaService) {}

  async getDocuments() {
    return [
      {
        id: '1',
        name: 'Monorepo Architecture Spec.pdf',
        size: 2400000,
        chunks: 128,
        status: 'indexed',
      },
      { id: '2', name: 'API Documentation v2.docx', size: 1100000, chunks: 64, status: 'indexed' },
    ]
  }
}
