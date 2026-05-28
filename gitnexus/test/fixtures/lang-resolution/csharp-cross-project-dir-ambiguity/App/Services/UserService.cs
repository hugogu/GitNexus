// Relative namespace import — `Model` is short for `App.Model`.
// Must resolve to App/Model/User.cs, NOT App.Tests/Model/UserTest.cs,
// even though App.Tests/Model/ sorts before App/Model/ alphabetically.
using Model;

namespace App.Services
{
    public class UserService
    {
        public string Process()
        {
            var u = new User();
            return u.GetName();
        }
    }
}
