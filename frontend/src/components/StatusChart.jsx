import React from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

export default function StatusChart({ active, inactive, maintenance }) {
    const data = {
        labels: ['Active', 'Inactive', 'Maintenance'],
        datasets: [{
            data: [active, inactive, maintenance],
            backgroundColor: ['#10b981', '#ef4444', '#f59e0b'],
            borderWidth: 0,
            hoverOffset: 4
        }]
    };

    const options = {
        cutout: '75%',
        plugins: {
            legend: { display: false },
            tooltip: { enabled: false }
        }
    };

    return <Doughnut data={data} options={options} />;
}
