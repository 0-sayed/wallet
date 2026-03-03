import { reportStatusEnum } from '../../common/database/schema';

export class ReportRequestResponseDto {
  /** Report job UUID */
  jobId!: string;

  /** Current job status */
  status!: (typeof reportStatusEnum.enumValues)[number];
}
