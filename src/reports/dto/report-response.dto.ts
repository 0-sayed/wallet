import { ReportRequestResponseDto } from './report-request-response.dto';

export class ReportResponseDto extends ReportRequestResponseDto {
  /** Report data when completed, null otherwise */
  result!: unknown;
}
