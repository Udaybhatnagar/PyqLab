function makePaper(id, title, subject, detail, entries) {
  return {
    id, title, subject, detail, sample: true,
    questions: entries.map(([prompt, options, correct], index) => ({
      number: index + 1, prompt, options: options.split('|'), correct,
      type: correct.length > 1 ? 'msq' : 'mcq',
    })),
  };
}

export const samplePapers = [
  makePaper('sample-physics', 'Mechanics & Motion', 'Physics', 'Practice paper 01', [
    ['A ball is thrown vertically upwards. What is its acceleration at the highest point?', 'Zero|g upwards|g downwards|It depends on the initial speed', [2]],
    ['Which of the following are vector quantities?', 'Velocity|Kinetic energy|Displacement|Speed', [0, 2]],
    ['A 2 kg object accelerates at 3 m/s². What is the magnitude of the net force?', '1.5 N|5 N|6 N|9 N', [2]],
    ['Which quantities remain constant for a projectile in ideal conditions?', 'Horizontal component of velocity|Vertical component of velocity|Acceleration due to gravity|Speed', [0, 2]],
    ['If the speed of an object doubles, by what factor does its kinetic energy change?', '2|4|8|It stays the same', [1]],
    ['Which quantities have SI units that can be written as N·s?', 'Momentum|Impulse|Power|Work', [0, 1]],
    ['An object moves at constant speed around a circle. In what direction is the net force?', 'Along the velocity|Away from the centre|Toward the centre|The net force is zero', [2]],
    ['What is conserved in every collision in an isolated system?', 'Total momentum|Total kinetic energy|Speed of each object|Velocity of each object', [0]],
  ]),
  makePaper('sample-maths', 'Calculus Essentials', 'Mathematics', 'Practice paper 02', [
    ['What is the derivative of x³ + 2x at x = 1?', '2|3|4|5', [3]],
    ['Which functions have derivative zero at x = 0?', 'x²|sin x|cos x|eˣ', [0, 2]],
    ['What is the integral of 2x from 0 to 3?', '3|6|9|18', [2]],
    ['Which functions are continuous on all of ℝ?', 'Absolute value|1/x|sin x|ln x', [0, 2]],
    ['What is the slope of the tangent to y = x² at x = 3?', '2|3|6|9', [2]],
    ['Which functions are increasing on (0, ∞)?', 'x²|−x|ln x|1/x', [0, 2]],
    ['What is the limit of sin(x)/x as x approaches zero?', '0|1|−1|The limit does not exist', [1]],
    ['At which x-value does f(x) = x² − 4x + 1 attain its minimum?', '−2|0|1|2', [3]],
  ]),
  makePaper('sample-cs', 'Data Structures', 'Computer Science', 'Practice paper 03', [
    ['Which data structure follows last in, first out order?', 'Queue|Stack|Heap|Hash table', [1]],
    ['Which operations on a conventional singly linked list can run in O(1) with only the head available?', 'Insert at head|Access the k-th item|Remove the head|Search by value', [0, 2]],
    ['What is the worst-case time complexity of binary search on a sorted array?', 'O(1)|O(log n)|O(n)|O(n log n)', [1]],
    ['Which data structures naturally support representing a graph?', 'Adjacency matrix|Adjacency list|Single integer|Boolean flag', [0, 1]],
    ['How many edges are in a tree on n vertices?', 'n − 1|n|n + 1|2n', [0]],
    ['Which are valid strategies for resolving hash collisions?', 'Separate chaining|Linear probing|Breadth-first search|Quadratic probing', [0, 1, 3]],
    ['Which traversal visits a binary search tree in ascending order?', 'Preorder|Postorder|Inorder|Level order', [2]],
    ['Which structure is typically used for breadth-first search?', 'Stack|Queue|Heap|Segment tree', [1]],
  ]),
];
