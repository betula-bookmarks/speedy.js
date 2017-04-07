export async function tspArray() {
    "use speedyjs";

    const points = [
        9860, 14152,
        9396, 14616,
        11252, 14848,
        11020, 13456,
        9512, 15776,
        10788, 13804,
        10208, 14384,
        11600, 13456,
        11252, 14036,
        10672, 15080,
        11136, 14152,
        9860, 13108,
        10092, 14964,
        9512, 13340,
        10556, 13688,
        9628, 14036,
        10904, 13108,
        11368, 12644,
        11252, 13340,
        10672, 13340,
        11020, 13108,
        11020, 13340,
        11136, 13572,
        11020, 13688,
        8468, 11136,
        8932, 12064,
        9512, 12412,
        7772, 11020,
        8352, 10672,
        9164, 12876,
        9744, 12528,
        8352, 10324,
        8236, 11020,
        8468, 12876,
        8700, 14036,
        8932, 13688,
        9048, 13804,
        8468, 12296,
        8352, 12644,
        8236, 13572,
        9164, 13340,
        8004, 12760,
        8584, 13108,
        7772, 14732,
        7540, 15080,
        7424, 17516,
        8352, 17052,
        7540, 16820,
        7888, 17168,
        9744, 15196,
        9164, 14964,
        9744, 16240,
        7888, 16936,
        8236, 15428,
        9512, 17400,
        9164, 16008,
        8700, 15312,
        11716, 16008,
        12992, 14964,
        12412, 14964,
        12296, 15312,
        12528, 15196,
        15312, 6612,
        11716, 16124,
        11600, 19720,
        10324, 17516,
        12412, 13340,
        12876, 12180,
        13688, 10904,
        13688, 11716,
        13688, 12528,
        11484, 13224,
        12296, 12760,
        12064, 12528,
        12644, 10556,
        11832, 11252,
        11368, 12296,
        11136, 11020,
        10556, 11948,
        10324, 11716,
        11484, 9512,
        11484, 7540,
        11020, 7424,
        11484, 9744,
        16936, 12180,
        17052, 12064,
        16936, 11832,
        17052, 11600,
        13804, 18792,
        12064, 14964,
        12180, 15544,
        14152, 18908,
        5104, 14616,
        6496, 17168,
        5684, 13224,
        15660, 10788,
        5336, 10324,
        812, 6264,
        14384, 20184,
        11252, 15776,
        9744, 3132,
        10904, 3480,
        7308, 14848,
        16472, 16472,
        10440, 14036,
        10672, 13804,
        1160, 18560,
        10788, 13572,
        15660, 11368,
        15544, 12760,
        5336, 18908,
        6264, 19140,
        11832, 17516,
        10672, 14152,
        10208, 15196,
        12180, 14848,
        11020, 10208,
        7656, 17052,
        16240, 8352,
        10440, 14732,
        9164, 15544,
        8004, 11020,
        5684, 11948,
        9512, 16472,
        13688, 17516,
        11484, 8468,
        3248, 14152,
    ];

    return tspSync(points);
}

function tspSync(points: int[]) {
    "use speedyjs";

    let currentX = points.shift()!;
    let currentY = points.shift()!;
    const solution: int[] = [currentX, currentY];

    while (points.length) {
        let shortestDistance: number = 2.0**31.0 - 1.0;
        let nearestIndex = 0;

        for (let i = 0; i < points.length - 1; i += 2) {
            const distance = euclideanDistance(currentX, currentY, points[i], points[i+1]);

            if (distance < shortestDistance) {
                shortestDistance = distance;
                nearestIndex = i;
            }
        }

        currentX = points[nearestIndex];
        currentY = points[nearestIndex + 1];

        solution.push(currentX, currentY);
        points.splice(nearestIndex, 2);
    }

    return computeCost(solution);
}

function computeCost(tour: int[]) {
    "use speedyjs";
    let total = 0.0;

    for (let i = 3; i < tour.length; i += 2) {
        total += euclideanDistance(tour[i - 3], tour[i - 2], tour[i - 1], tour[i]);
    }

    total += euclideanDistance(tour[tour.length - 2], tour[tour.length - 1], tour[0], tour[1]);

    return total;
}

function euclideanDistance(x1: int, y1: int, x2: int, y2: int): number {
    "use speedyjs";

    return Math.sqrt(Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2));
}
