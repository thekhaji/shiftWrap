import ExcelJS from 'exceljs';
import { Member } from '../libs/types/member';
import { Attendance } from '../libs/types/attendance';

class ReportService {

    async generateReportFile(member: Member, shifts: Attendance[], year: number, month: number): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();
        this.addEmployeeSheet(workbook, member, shifts, year, month);

        const excelBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(excelBuffer);
    }

    async generateBranchReportFile(
        members: Member[],
        shiftsByMember: Map<string, Attendance[]>,
        year: number,
        month: number
    ): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();

        for (const member of members) {
            const shifts = shiftsByMember.get(member._id.toString()) ?? [];
            this.addEmployeeSheet(workbook, member, shifts, year, month);
        }

        const excelBuffer = await workbook.xlsx.writeBuffer();
        return Buffer.from(excelBuffer);
    }

    // The file an employee downloads before submitting: every shift has its own row and a hidden id,
    // times are plain HH:MM cells with live formulas, so an edited file can be read back safely.
    async generateSubmissionFile(member: Member, shifts: Attendance[], branchId: string, year: number, month: number): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook();
        this.addEmployeeSheet(workbook, member, shifts, year, month, { branchId });
        return Buffer.from(await workbook.xlsx.writeBuffer());
    }

    private addEmployeeSheet(workbook: ExcelJS.Workbook, member: Member, shifts: Attendance[], year: number, month: number, editable?: { branchId: string }): void {
        const sheet = workbook.addWorksheet(member.name);

        let totalMinutes = 0;
        const daysInMonth = new Date(year, month, 0).getDate();
        const shiftsByDay = new Map<number, Attendance[]>();

        sheet.getCell('A1').value = 'Name:';
        sheet.getCell('A1').font = { bold: true };
        sheet.getCell('B1').value = member.name;
        sheet.mergeCells('B1:E1');
        sheet.getCell('B1').font = { bold: true };
        sheet.getCell('B1').alignment = { horizontal: 'center' };

        sheet.addRow([]);

        sheet.mergeCells('C2:D2');
        sheet.getCell('C2').value = 'TIME';
        sheet.getCell('C2').font = { bold: true };
        sheet.getCell('C2').alignment = { horizontal: 'center' };

        const headerRow = sheet.addRow(['Number of days', 'Days', 'From', 'To', 'Total Hours']);
        headerRow.eachCell(cell => {
            cell.font = { bold: true };
            cell.alignment = { horizontal: 'center' };
        });

        sheet.columns = [
            { width: 16 },
            { width: 14 },
            { width: 12 },
            { width: 12 },
            { width: 12 },
        ];

        for (const shift of shifts) {
            const day = new Date(shift.checkIn).getUTCDate();
            shiftsByDay.set(day, [...(shiftsByDay.get(day) ?? []), shift]);
        }

        const firstDataRow = sheet.rowCount + 1;
        const timeOfDay = (d: Date) => (d.getUTCHours() * 60 + d.getUTCMinutes()) / 1440;

        for (let day = 1; day <= daysInMonth; day++) {
            const dateForDay = formatLocalDate(year, month, day);
            const dayShifts = shiftsByDay.get(day) ?? [];

            if (editable) {
                // a day without shifts still gets one empty row, so a missing day can be filled in
                for (const shift of dayShifts.length ? dayShifts : [undefined]) {
                    const from = shift ? new Date(shift.checkIn) : undefined;
                    const to = shift?.checkOut ? new Date(shift.checkOut) : undefined;
                    const minutes = from && to ? Math.round((to.getTime() - from.getTime()) / 60000) : 0;
                    totalMinutes += minutes;

                    const row = sheet.addRow([
                        day, dateForDay,
                        from ? timeOfDay(from) : null,
                        to ? timeOfDay(to) : null,
                        null,
                        shift ? String((shift as any)._id) : null,
                    ]);
                    const r = row.number;
                    row.getCell(5).value = { formula: `IF(AND(C${r}<>"",D${r}<>""),MOD(D${r}-C${r},1),"")`, result: minutes ? minutes / 1440 : '' };
                    row.getCell(3).numFmt = 'hh:mm';
                    row.getCell(4).numFmt = 'hh:mm';
                    row.getCell(5).numFmt = '[h]:mm';
                    row.eachCell({ includeEmpty: true }, (cell, col) => { if (col <= 5) cell.alignment = { horizontal: 'center' }; });
                }
                continue;
            }

            if (dayShifts.length === 0) {
                const row = sheet.addRow([day, dateForDay]);
                row.eachCell(cell => cell.alignment = { horizontal: 'center' });
                continue;
            }

            for (const shift of dayShifts) {
                const from = new Date(shift.checkIn);

                if (!shift.checkOut) {
                    const row = sheet.addRow([day, dateForDay, from, '⚠️ No check-out']);
                    row.eachCell(cell => cell.alignment = { horizontal: 'center' });
                    continue;
                }

                const to = new Date(shift.checkOut);
                const minutes = Math.round((to.getTime() - from.getTime()) / 60000);
                totalMinutes += minutes;

                const row = sheet.addRow([day, dateForDay, from, to, minutes / 1440]);
                row.eachCell(cell => cell.alignment = { horizontal: 'center' });
                row.getCell(3).numFmt = 'hh:mm AM/PM';
                row.getCell(4).numFmt = 'hh:mm AM/PM';
                row.getCell(5).numFmt = '[h]:mm';
            }
        }

        const lastDataRow = sheet.rowCount;
        sheet.addRow([]);

        const addSummaryRow = (label: string, value: ExcelJS.CellValue, numFmt?: string): number => {
            const rowNum = sheet.rowCount + 1;
            sheet.mergeCells(`A${rowNum}:D${rowNum}`);
            const labelCell = sheet.getCell(`A${rowNum}`);
            labelCell.value = label;
            labelCell.font = { bold: true };
            labelCell.alignment = { horizontal: 'center' };

            const valueCell = sheet.getCell(`E${rowNum}`);
            valueCell.value = value;
            valueCell.font = { bold: true };
            valueCell.alignment = { horizontal: 'center' };
            if (numFmt) valueCell.numFmt = numFmt;
            return rowNum;
        };

        const hoursRow = addSummaryRow(
            'Total Worked Hours',
            editable ? { formula: `SUM(E${firstDataRow}:E${lastDataRow})`, result: totalMinutes / 1440 } : totalMinutes / 1440,
            '[h]:mm'
        );
        addSummaryRow('Wage for per hour', member.hourlyRate ?? 'N/A');
        const wage = Math.round((totalMinutes / 60) * (member.hourlyRate ?? 0));
        addSummaryRow('Total wage', editable ? { formula: `ROUND(E${hoursRow}*24*${member.hourlyRate ?? 0},0)`, result: wage } : wage);

        if (member.bankName && member.bankAccount) {
            addSummaryRow(member.bankName, member.bankAccount);
        } else {
            addSummaryRow('Bank details', 'Not available');
        }

        this.applyBorderToRange(sheet, 1, sheet.rowCount, 1, 5);

        if (editable) {
            // read back by the submission flow: proves which employee, branch and month the file is for
            sheet.getCell('F1').value = `shiftwrap:${member._id}:${editable.branchId}:${year}:${month}`;
            sheet.getColumn(6).hidden = true;
        }
    }

    applyBorderToRange(sheet: ExcelJS.Worksheet, startRow: number, endRow: number, startCol: number, endCol: number) {
        for (let r = startRow; r <= endRow; r++) {
            for (let c = startCol; c <= endCol; c++) {
                const cell = sheet.getCell(r, c);
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' },
                };
            }
        }
    }
}

function formatLocalDate(year: number, month: number, day: number): string {
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
}

export default ReportService;